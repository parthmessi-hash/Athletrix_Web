/* Athletrix local video review: pure logic (window.AthletrixVideoReview) plus the page wiring in video-review.html.
 * Everything stays in this browser tab: the video is opened from disk with an object URL and never uploaded. The only
 * network request is the optional "send observation" to a LOCAL engine (loopback host only), made when you click it.
 *
 * Identity rule (the same as camera_adapter/observations.py apply_assignments): an assignment covers its track from
 * its first frame only up to the track's first close encounter (an observation with near_other_track, which the
 * extractor holds for its release time after the boxes separate) after that frame. From there the track needs a new
 * assignment by a person. A track that is simply available again after the release period is NOT confirmed.
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
    var frames = Object.keys(byFrame).map(Number);
    return { header: header, fps: header.video.fps, byFrame: byFrame, byTrack: byTrack, lastFrame: frames.length ? Math.max.apply(null, frames) : 0 };
  }

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
      if (o.near_other_track && o.frame > a.from_frame && o.frame <= frame) return { state: "needs_reconfirmation", athlete_id: a.athlete_id, encounter_frame: o.frame, assignment: a };
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

  function exportDoc(state, data) {
    var doc = { format: "athletrix-track-assignments", format_version: 2, assignments: state.assignments.map(function (a) { return Object.assign({}, a); }) };
    if (state.video && state.video.sha256) doc.video = { name: state.video.name, sha256: state.video.sha256 };
    doc.operator_work = { seconds_spent: Math.round(state.work.seconds_spent), confirmations: state.work.confirmations, corrections: state.work.corrections,
                          uncertain_marks: state.work.uncertain_marks, unassigned_seconds: data ? unassignedSeconds(data, state.assignments) : null, tool: "Athletrix_Web tools/video-review.html" };
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

  function newState(operator) { return { operator: operator, assignments: [], video: null, work: { seconds_spent: 0, confirmations: 0, corrections: 0, uncertain_marks: 0 } }; }

  function isLoopback(host) { return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1" || /\.localhost$/.test(host); }

  root.AthletrixVideoReview = { parseObservations: parseObservations, trackState: trackState, assign: assign, endAssignment: endAssignment, unassignedSeconds: unassignedSeconds,
                                exportDoc: exportDoc, observationBody: observationBody, newState: newState, isLoopback: isLoopback };
})(typeof window !== "undefined" ? window : this);
