/* Athletrix local video review: pure logic (window.AthletrixVideoReview) plus the page wiring in video-review.html.
 * Everything stays in this browser tab: the video is opened from disk with an object URL and never uploaded. The only
 * network request is the optional "send observation" to a LOCAL engine (loopback host only), made when you click it.
 *
 * Identity rule (the same as camera_adapter/observations.py apply_assignments): an assignment covers its track from
 * its first frame only up to the track's first close encounter (an observation with near_other_track, which the
 * extractor holds for its release time after the boxes separate) after that frame. From there the track needs a new
 * assignment by a person. A track that is simply available again after the release period is NOT confirmed. The same
 * applies after a gap longer than LAPSE_GAP_S in a track's observations (prolonged occlusion, or a lost and resumed
 * track): camera_adapter/observations.py lapse_after_gap_s.
 *
 * Confirmation queue: every interval a person must look at (a track's start or a likely restart, the end of each
 * encounter hold, the end of each long gap), with the frame from which a confirmation can be made. Reaching that frame
 * makes the track ELIGIBLE for confirmation; it never identifies anyone. Tasks are resolved only by a person:
 * confirmed, marked uncertain, or left unassigned (for example a referee). Nothing is filled in by guessing.
 */
(function (root) {
  "use strict";

  function parseObservations(text) {
    var lines = String(text).split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (!lines.length) throw new Error("empty observations file");
    var header = JSON.parse(lines[0]);
    if (header.format !== "athletrix-camera-observations") throw new Error("not an athletrix-camera-observations file");
    var byFrame = {}, byTrack = {};
    for (var i = 1; i < lines.length; i++) {
      var o = JSON.parse(lines[i]);
      (byFrame[o.frame] = byFrame[o.frame] || []).push(o);
      (byTrack[o.track_id] = byTrack[o.track_id] || []).push(o);
    }
    var frames = Object.keys(byFrame).map(Number), fps = header.video.fps, gapFrames = {};
    Object.keys(byTrack).forEach(function (t) {
      byTrack[t].sort(function (a, b) { return a.frame - b.frame; });
      for (var k = 1; k < byTrack[t].length; k++) {
        if ((byTrack[t][k].frame - byTrack[t][k - 1].frame) / fps > LAPSE_GAP_S + 1e-9) (gapFrames[t] = gapFrames[t] || []).push(byTrack[t][k].frame);
      }
    });
    return { header: header, fps: fps, byFrame: byFrame, byTrack: byTrack, gapFrames: gapFrames, lastFrame: frames.length ? Math.max.apply(null, frames) : 0 };
  }
  var LAPSE_GAP_S = 1.0;

  function covering(assignments, track, frame) {
    for (var i = 0; i < assignments.length; i++) {
      var a = assignments[i];
      if (a.track_id === track && a.from_frame <= frame && (a.to_frame === null || a.to_frame === undefined || frame <= a.to_frame)) return a;
    }
    return null;
  }

  // state of one track at one frame: assigned | uncertain | needs_reconfirmation | unassigned
  function trackState(data, assignments, track, frame) {
    var a = covering(assignments, track, frame);
    if (!a) return { state: "unassigned" };
    if (a.identity === "uncertain") return { state: "uncertain", athlete_id: a.athlete_id, assignment: a };
    var obs = data.byTrack[track] || [];
    for (var i = 0; i < obs.length; i++) {
      var o = obs[i];
      if (o.near_other_track && o.frame > a.from_frame && o.frame <= frame) return { state: "needs_reconfirmation", athlete_id: a.athlete_id, encounter_frame: o.frame, reason: "encounter", assignment: a };
    }
    var gaps = (data.gapFrames || {})[track] || [];
    for (var g = 0; g < gaps.length; g++) {
      if (gaps[g] > a.from_frame && gaps[g] <= frame) return { state: "needs_reconfirmation", athlete_id: a.athlete_id, gap_frame: gaps[g], reason: "gap", assignment: a };
    }
    return { state: "assigned", athlete_id: a.athlete_id, assignment: a };
  }

  // a new time-bounded assignment from `frame`: an open assignment of the same track is closed the frame before
  function assign(state, track, athlete, frame, identity) {
    var prev = null;
    state.assignments.forEach(function (a) {
      if (a.track_id === track && a.from_frame < frame && (a.to_frame === null || a.to_frame >= frame)) { a.to_frame = frame - 1; prev = a; }
      if (a.track_id === track && a.from_frame === frame) prev = prev || a;
    });
    state.assignments = state.assignments.filter(function (a) { return !(a.track_id === track && a.from_frame >= frame); });
    state.assignments.push({ track_id: track, athlete_id: athlete, from_frame: frame, to_frame: null, assigned_by: state.operator || "operator", identity: identity, confirmed_by: "person" });
    state.assignments.sort(function (x, y) { return x.track_id < y.track_id ? -1 : x.track_id > y.track_id ? 1 : x.from_frame - y.from_frame; });
    if (identity === "uncertain") state.work.uncertain_marks += 1; else state.work.confirmations += 1;
    if (prev && prev.athlete_id !== athlete) state.work.corrections += 1;
  }

  function endAssignment(state, track, frame) {
    var a = covering(state.assignments, track, frame);
    if (!a) return false;
    if (a.from_frame === frame) state.assignments = state.assignments.filter(function (x) { return x !== a; }); else a.to_frame = frame - 1;
    return true;
  }

  // observation-seconds (summed over tracks) without a usable assignment: unassigned, uncertain or awaiting re-confirmation
  function unassignedSeconds(data, assignments) {
    var n = 0;
    Object.keys(data.byTrack).forEach(function (t) { data.byTrack[t].forEach(function (o) { if (trackState(data, assignments, t, o.frame).state !== "assigned") n += 1; }); });
    return Math.round(10 * n / data.fps) / 10;
  }

  // tasks: [{id, track_id, kind: track_start|track_restart|after_encounter|after_gap, eligible_frame, context_from, ...}]
  function confirmationQueue(data, state) {
    var tasks = [], fps = data.fps, tracks = Object.keys(data.byTrack).sort();
    var ends = tracks.map(function (t) { var o = data.byTrack[t]; return { t: t, last: o[o.length - 1], first: o[0] }; });
    tracks.forEach(function (t) {
      var obs = data.byTrack[t], first = obs[0];
      var prior = ends.filter(function (e) { return e.t !== t && e.last.frame < first.frame && (first.frame - e.last.frame) / fps <= 2 &&
                                                   Math.hypot(e.last.u_px - first.u_px, e.last.v_px - first.v_px) <= 60; });
      tasks.push({ track_id: t, kind: prior.length ? "track_restart" : "track_start", eligible_frame: first.frame, context_from: prior.length ? prior[0].last.frame : first.frame,
                   note: prior.length ? "a new track id close to where " + prior.map(function (e) { return e.t; }).join(", ") + " was lost: possibly the same person, possibly not" : "first appearance of this track" });
      var i = 0;
      while (i < obs.length) {
        if (!obs[i].near_other_track) { i++; continue; }
        var a = i;
        // one episode while flagged observations follow each other; a missed detection inside the hold does not end it
        while (i + 1 < obs.length && obs[i + 1].near_other_track && (obs[i + 1].frame - obs[i].frame) / fps <= LAPSE_GAP_S + 1e-9) i++;
        var from = obs[a].frame, to = obs[i].frame, next = obs[i + 1];
        var others = {};
        for (var f = from; f <= to; f++) (data.byFrame[f] || []).forEach(function (o) { if (o.track_id !== t && o.near_other_track) others[o.track_id] = true; });
        tasks.push({ track_id: t, kind: "after_encounter", encounter_from: from, encounter_to: to, eligible_frame: next ? next.frame : null, context_from: from,
                     near: Object.keys(others).sort(), note: "close encounter frames " + from + "-" + to + " (the flag stays on for the extractor's release period after the boxes separate); " +
                     (next ? "eligible from frame " + next.frame + ": this does not identify the player" : "the track ends inside the hold") });
        i++;
      }
      ((data.gapFrames || {})[t] || []).forEach(function (gf) {
        var before = obs.filter(function (o) { return o.frame < gf; }).pop();
        tasks.push({ track_id: t, kind: "after_gap", gap_from: before.frame, eligible_frame: gf, context_from: before.frame, gap_s: Math.round(100 * (gf - before.frame) / fps) / 100,
                     note: "not seen for " + Math.round(100 * (gf - before.frame) / fps) / 100 + " s (occlusion or a lost track); eligible from frame " + gf + ": this does not identify the player" });
      });
    });
    tasks.sort(function (x, y) { return (x.eligible_frame === null ? 1e12 : x.eligible_frame) - (y.eligible_frame === null ? 1e12 : y.eligible_frame) || (x.track_id < y.track_id ? -1 : 1); });
    tasks.forEach(function (k) {
      k.id = k.track_id + "@" + k.kind + "@" + k.eligible_frame;
      var later = tasks.filter(function (o) { return o.track_id === k.track_id && o.eligible_frame !== null && k.eligible_frame !== null && o.eligible_frame > k.eligible_frame; })
                       .map(function (o) { return o.eligible_frame; });
      var until = later.length ? Math.min.apply(null, later) - 1 : Infinity;
      var made = k.eligible_frame === null ? null : state.assignments.filter(function (a) { return a.track_id === k.track_id && a.from_frame >= k.eligible_frame && a.from_frame <= until; })[0];
      var left = (state.left || {})[k.id];
      k.status = k.eligible_frame === null ? "no_frames_to_confirm" : made ? (made.identity === "uncertain" ? "marked_uncertain" : "confirmed") : left ? "left_unassigned" : "open";
      if (made) { k.resolved_by = made.confirmed_by; k.athlete_id = made.athlete_id; }
      if (left) k.reason_left = left;
    });
    return tasks;
  }

  function leaveUnassigned(state, taskId, reason) { state.left = state.left || {}; state.left[taskId] = reason || "left unassigned"; state.work.left_unassigned = (state.work.left_unassigned || 0) + 1; }

  function queueSummary(data, state) {
    var q = confirmationQueue(data, state), count = function (st) { return q.filter(function (k) { return k.status === st; }).length; };
    var total = 0;
    Object.keys(data.byTrack).forEach(function (t) { total += data.byTrack[t].length; });
    var unassigned = unassignedSeconds(data, state.assignments), all = Math.round(10 * total / data.fps) / 10;
    var by = {};
    state.assignments.forEach(function (a) { by[a.confirmed_by || "person"] = true; });
    return { tasks: q.length, open: count("open"), confirmed: count("confirmed"), marked_uncertain: count("marked_uncertain"), left_unassigned: count("left_unassigned"),
             no_frames_to_confirm: count("no_frames_to_confirm"), corrections: state.work.corrections, unassigned_seconds: unassigned, observed_seconds: all,
             coverage: all ? Math.round(1000 * (1 - unassigned / all)) / 1000 : null, operator_seconds: Math.round(state.work.seconds_spent),
             assignments_from: Object.keys(by).sort(), kinds: q.reduce(function (m, k) { m[k.kind] = (m[k.kind] || 0) + 1; return m; }, {}) };
  }

  function exportDoc(state, data) {
    var doc = { format: "athletrix-track-assignments", format_version: 2, assignments: state.assignments.map(function (a) { return Object.assign({}, a); }) };
    if (state.video && state.video.sha256) doc.video = { name: state.video.name, sha256: state.video.sha256 };
    doc.operator_work = { seconds_spent: Math.round(state.work.seconds_spent), confirmations: state.work.confirmations, corrections: state.work.corrections,
                          uncertain_marks: state.work.uncertain_marks, unassigned_seconds: data ? unassignedSeconds(data, state.assignments) : null, tool: "Athletrix_Web tools/video-review.html" };
    if (data) doc.operator_work.confirmation_tasks = queueSummary(data, state);
    return doc;
  }

  // a manual performance observation for one track over [fromFrame, toFrame], linked to the reviewed file
  function observationBody(opts) {
    var fps = opts.fps, start = new Date(Date.parse(opts.anchorUtc) + 1000 * opts.fromFrame / fps), end = new Date(Date.parse(opts.anchorUtc) + 1000 * opts.toFrame / fps);
    if (!(end > start)) throw new Error("the end frame must come after the start frame");
    var b = { athlete_id: opts.athleteId, kind: opts.kind, area: { pass: "execution", turnover: "execution", tactical_observation: "coach_strategy" }[opts.kind],
              period_start: start.toISOString(), period_end: end.toISOString(), assessment: opts.assessment, evidence_source: "human_review_of_camera",
              identity: opts.trackState === "assigned" ? "confirmed" : "uncertain", annotator: opts.annotator || undefined,
              frames: [{ video: opts.videoName, frame: opts.fromFrame, video_time_s: Math.round(1e6 * opts.fromFrame / fps) / 1e6, video_sha256: opts.videoSha || undefined },
                       { video: opts.videoName, frame: opts.toFrame, video_time_s: Math.round(1e6 * opts.toFrame / fps) / 1e6, video_sha256: opts.videoSha || undefined }] };
    if (opts.assessment === "unable_to_assess") b.unable_reason = opts.unableReason || "ambiguous";
    if (opts.assessment === "assessed" && opts.kind === "pass") { b.attempts = opts.attempts; b.completions = opts.completions; }
    if (opts.assessment === "assessed" && opts.kind === "turnover") { b.possessions = opts.attempts; b.turnovers = opts.completions; }
    if (opts.assessment === "assessed" && opts.kind === "tactical_observation") { b.outcome = opts.outcome; b.instruction = opts.instruction; }
    return JSON.parse(JSON.stringify(b));   // drops undefined fields
  }

  // ---- blind annotation sheets (same format as app/core/annotation.py; nothing here judges anything automatically) ----
  var JUDGEMENTS = { decision: ["good", "acceptable", "poor"], positioning: ["good", "acceptable", "poor"], tactical: ["followed", "partially_followed", "not_followed"] };
  function sheetCheck(sheet, reviewer) {
    if (!sheet || sheet.format !== "athletrix-annotation-sheet" || sheet.format_version !== 1) return { ok: false, problem: "not an athletrix-annotation-sheet version 1 file" };
    if (!reviewer) return { ok: false, problem: "enter your reviewer name (Operator) first" };
    var labelled = sheet.moments.some(function (m) { return m.labels && Object.keys(m.labels).length; });
    if (labelled && sheet.reviewer && sheet.reviewer !== reviewer)
      return { ok: false, problem: "this sheet already holds labels by " + sheet.reviewer + "; to annotate independently, load a blank copy (scripts/annotate.py blank)" };
    return { ok: true };
  }
  function setLabel(sheet, momentId, q, lab) {
    var m = sheet.moments.filter(function (x) { return x.id === momentId; })[0];
    if (!m) throw new Error("no moment " + momentId);
    if ((m.asks || []).indexOf(q) < 0) throw new Error("question " + q + " is not asked for " + momentId);
    var out = { assessment: lab.assessment };
    if (lab.assessment === "unable_to_assess") { if (!lab.unable_reason) throw new Error("say why it cannot be assessed"); out.unable_reason = lab.unable_reason; }
    else if (lab.assessment === "assessed") {
      if (q === "execution_pass") {
        if (!(lab.attempts >= 1 && lab.completions >= 0 && lab.completions <= lab.attempts)) throw new Error("attempts >= 1 and 0 <= completions <= attempts");
        out.attempts = lab.attempts; out.completions = lab.completions;
      } else {
        if (JUDGEMENTS[q].indexOf(lab.judgement) < 0) throw new Error("choose a judgement");
        out.judgement = lab.judgement;
      }
    } else if (lab.assessment !== "no_opportunity") throw new Error("choose an assessment");
    if (lab.confidence) out.confidence = lab.confidence;
    if (lab.rationale) out.rationale = lab.rationale;
    m.labels = m.labels || {}; m.labels[q] = out;
    return out;
  }
  function sheetProgress(sheet) {
    var asked = 0, done = 0;
    sheet.moments.forEach(function (m) { (m.asks || []).forEach(function (q) { asked++; if (m.labels && m.labels[q]) done++; }); });
    return { asked: asked, labelled: done };
  }

  function newState(operator) { return { operator: operator, assignments: [], video: null, left: {}, work: { seconds_spent: 0, confirmations: 0, corrections: 0, uncertain_marks: 0 } }; }

  function isLoopback(host) { return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1" || /\.localhost$/.test(host); }

  root.AthletrixVideoReview = { parseObservations: parseObservations, trackState: trackState, assign: assign, endAssignment: endAssignment, unassignedSeconds: unassignedSeconds,
                                exportDoc: exportDoc, observationBody: observationBody, newState: newState, isLoopback: isLoopback,
                                confirmationQueue: confirmationQueue, leaveUnassigned: leaveUnassigned, queueSummary: queueSummary, LAPSE_GAP_S: LAPSE_GAP_S,
                                sheetCheck: sheetCheck, setLabel: setLabel, sheetProgress: sheetProgress, JUDGEMENTS: JUDGEMENTS };
})(typeof window !== "undefined" ? window : this);
