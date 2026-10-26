# Athletrix Web

Marketing site and demo dashboard for Athletrix. A single static page
(`index.html`) with no build step.

The backend/engine lives in the separate `Athletrix_Vision_Synopsis_2026`
repository. The page has two kinds of demo content:

- **Engine-connected cards** (blue left border, "Engine-connected" badge):
  an athlete selector plus the **Live Heart Rate**, **Live Tracking** and
  **Last 60 seconds** cards, which poll the Athletrix engine for the selected
  athlete. Shown only in *engine mode* (see below).
- **Browser demo** (amber "Browser demo · fictional data" banner): the rest
  of the dashboard, with fictional players, vitals, a 0–100 demo load index
  and example rotation notes generated entirely in the browser. These numbers
  are illustrative; they do not measure fatigue or decide substitutions, and
  they are never substituted for engine data when the engine is unreachable.

## Engine mode and configuration

The page picks a mode on load:

| Mode | When | What the visitor sees |
|------|------|-----------------------|
| `engine` | hostname is `localhost`, `127.0.0.1`, `[::1]` or `*.localhost` | Athlete selector and the three engine-connected cards, polling the engine |
| `public` | any other hostname (e.g. the published site) | An explanation card that the engine dashboard runs on the sideline computer, with an **Open local dashboard** link to `http://localhost:3000/#demo` and the startup steps. No requests are made to the engine. |

Override it in the `axEngineConfig` script block near the bottom of
`index.html` (or by defining `window.ATHLETRIX_CONFIG` before it):

```html
<script>
  window.ATHLETRIX_CONFIG = { engineMode: "engine", apiBase: "https://engine.example.internal" };
</script>
```

`engineMode` is `"auto"` (default), `"engine"` or `"public"`; `apiBase` is
the engine's base URL (the older `window.ATHLETRIX_API_BASE` is still
honoured). For a single page load, `?engine=1` or `?engine=0` in the URL
overrides `engineMode`, which is handy for testing public mode locally. The
engine's `CORS_ORIGINS` must include the origin the page is served from.

## Run the frontend

Serve the folder over HTTP (opening `index.html` directly from disk will not be
allowed to call the backend because of browser CORS rules):

```bash
cd Athletrix_Web
python3 -m http.server 3000
```

Open http://localhost:3000 and click **Live Demo** in the top navigation (or
open http://localhost:3000/#demo directly). On localhost the page is in
engine mode, so the **Athlete** selector and the three engine-connected cards
are at the top of the dashboard.

## Full local demo (backend + roster + two simulators + frontend)

Terminals 1 to 4 run from the `Athletrix_Vision_Synopsis_2026` folder with its
`.venv` activated; terminal 5 runs from this folder.

```bash
# 1. Backend
uvicorn app.main:app --reload

# 2. Register the fictional demo roster (athlete-1 Alex Example, athlete-2 Sam Sample)
python scripts/register_demo_roster.py

# 3. Simulators, one per athlete (fictional data)
python scripts/simulate_athlete.py --athlete-id athlete-1 --device-id simulator-1 --with-tracking
python scripts/simulate_athlete.py --athlete-id athlete-2 --device-id simulator-2 --with-tracking
#    For a repeating effort/rest cycle with a delayed toy heart-rate response (fictional, shows timing on the charts):
python scripts/simulate_athlete.py --profile effort-rest --with-tracking --seconds 120

# 4. Frontend (this folder)
python3 -m http.server 3000
```

Click path: open http://localhost:3000, click **Live Demo** in the top
navigation, then pick an athlete in the **Athlete** dropdown above the cards.
All three cards switch together. **Refresh roster** reloads the athlete list
from the backend and keeps your current selection when it is still present.

The backend persists the athlete registry, device statuses and the newest
300 samples per athlete per stream in a local SQLite file (`data/athletrix.db`
in the engine repository by default), so they survive backend restarts. The
roster script is a one-time step per database file and is safe to rerun.
After a restart the dashboard reconnects on its own and shows the retained
readings with their real age; run a simulator again for fresh values.

## What the cards show

- **Athlete selector**: roster from the backend's `GET /api/v1/athletes`,
  showing name, jersey number and sport. States: loading, empty roster (with
  the setup command), and roster connection error. It retries automatically
  every 10 seconds while the dashboard is visible and the roster is empty or
  unreachable. Athletes are never invented client-side and there is no silent
  fallback to `athlete-1`.
- **Live Heart Rate**: heart rate and sample time of the most recent
  physiological sample for the selected athlete, with a badge showing that
  sample's own reported source ("Reported source: simulated", "Reported
  source: wearable", or "Source not reported") and the device id in the
  status line. A `null` `heart_rate_bpm` is shown as "—", not 0.
- **Live Tracking**: speed in m/s, acceleration in m/s² (signed), tracking
  confidence as a percentage, and sample time of the most recent tracking
  sample, with the same kind of source badge taken from that sample. Tracking
  samples recorded before the optional `source` field existed show "Source
  not reported"; nothing is assumed. Zero is a real reading and is shown as
  `0.0 m/s`, never as missing.
- **Last 60 seconds**: fetched every 5 seconds
  from the backend summary endpoint. Shows mean and peak heart rate (bpm),
  peak speed (m/s), the heart-rate measurement count out of physiological
  samples, the tracking sample count, and for each stream the newest
  sample's age and the largest gap between consecutive samples, in seconds.
  It also shows the backend's **estimated distance** in metres with the
  eligible duration and percentage of the window it is based on, a
  "Distance basis" line with the excluded-interval count, and a footnote
  stating the gap and confidence rules the backend applied (values come from
  the response, not the page). The estimate sums consecutive tracking
  intervals that are close enough together and confident enough at both
  ends, assuming speed changes linearly between samples; excluded intervals
  are never bridged, so it covers only the eligible part of the window.
  "Not available" means no interval qualified; `0.0 m` means the eligible
  intervals were stationary. Two more tiles show **time and distance at or
  above the backend's speed threshold** (labelled with the actual threshold
  from the response, e.g. "Time at or above 5.0 m/s"), computed over the
  same eligible intervals with the same linear-speed assumption and
  interpolated crossings; each carries the eligible-duration and window
  percentage it is based on, so partial data cannot read as full-window
  activity. They are descriptive workload estimates, not detected sprints,
  fatigue classification or substitution advice. `null` values are shown as "Not available"; real
  zeros are shown as zeros. A successful fetch does not mean the data is
  live: the status line reports how old the newest samples were relative to
  the summary's window end, and an empty window says so. These are
  descriptive numbers only, not a guaranteed full-window distance or an
  athlete-condition score.

- **Recent movement and heart rate**: two small SVG charts (no external
  libraries, so engine mode works offline) drawn from the engine's
  60-second window endpoint every 5 seconds, sharing one time axis taken
  from the backend's returned window bounds. Heart rate (bpm) is on top,
  speed (m/s) below. Filled points are recorded samples; a hollow amber
  marker on the heart-rate baseline is a sample with no heart rate; a hollow
  amber marker on the speed chart is a tracking sample below the engine's
  applied confidence rule. That rule is read from the **same window
  response** as the samples (`tracking_rules.min_confidence`, the engine's
  `DISTANCE_MIN_CONFIDENCE`), so the very first render classifies points
  correctly and the card never depends on the summary request. If the rule
  is missing or invalid (not a number between 0 and 1), the card says that
  confidence filtering is unavailable: every speed point is drawn as a dashed
  grey *unclassified* marker at its recorded value, no point is assumed
  usable, and no line is drawn. Lines join consecutive samples only when
  both are usable and they are at most 3 s apart (a display rule); nothing
  is drawn across gaps or removed points, and neither stream is shifted to
  line peaks up. Confidence filtering compares each sample's reported
  tracking confidence with the engine's rule; it does not validate the
  accuracy of the underlying speed measurement. Each chart shows an
  explicit message when its stream is empty, and the card states that the
  charts group recorded timestamps only, without correcting device clocks
  or implying a physiological relationship. The window is bounded by the
  engine's 300-sample history cap per stream.

The two live cards poll once per second and the summary and timeline cards
every 5 seconds, only while the dashboard is visible, and each reports its
own state:

- **No sample yet** / **No samples recorded** if the backend has nothing
  stored for the selected athlete on that stream or in that window.
- **Cannot reach backend** if the backend is not running on `127.0.0.1:8000`.
- **Stopped updating** (live cards) if no new sample has arrived on that
  stream for 5 seconds (e.g. the simulator finished).

Switching athletes clears all three cards immediately and discards any
response that arrives for the previously selected athlete, so a slow reply
can never appear under another athlete's name. Each card shows its own
sample timestamp; the streams are polled and timestamped separately, so
showing them side by side does not mean they are synchronized.

## Selected effort review (Recorded mode)

In Recorded mode a **Selected effort review** card sits below the timeline.
You type an effort start and end (ISO 8601 with a timezone, 1 to 120 s
apart) and click **Review effort**; the page calls the engine's
`effort-review` endpoint and shows exactly what it returns. Nothing is
recalculated in the browser, nothing is detected automatically, and no
request is made until you click Review effort or **Refresh** (which
re-submits the same bounds for a fresh capture time).

The card shows the athlete, the effort bounds and duration, the engine's
capture time, and then:

- **Movement during the effort**: tracking sample count, peak speed,
  estimated distance, included duration and fraction of the effort, excluded
  intervals, time and distance at or above the engine's high-speed threshold,
  the applied rules (gap, confidence, threshold, and the 10 s / 30 s period
  lengths, all engineering defaults) and the reported sources.
- **Heart rate before, during and after**: a three-column comparison of
  non-null measurements out of samples, arithmetic mean, peak and largest
  inter-sample gap, with a collapsible details line per period giving the
  applied bounds (with the half-open side marked), first and last sample
  timestamps and sources.
- **Follow-up**: whether the 30 s after the effort had elapsed at capture
  time, or that the after period is capped at the capture time. Either way
  the card states that elapsed time does not establish that samples were
  received, retained or complete, and that a heart-rate difference between
  periods is a description of recorded samples, not a recovery measure or a
  change in condition.

Null heart rates are shown as "Not available", never 0; a stationary effort
shows real zeros (`0.0 m/s`, `0.0 m`); a period without samples shows
"0 of 0 samples"; an effort without tracking samples says so and marks the
distance and high-speed figures as not available. Times in the results are
labelled UTC. Page-side validation refuses empty, timezone-less, invalid or
reversed inputs without a request; an engine 422 (for example a duration
outside 1 to 120 s or an end in the future) is shown with the engine's
reason, and backend errors are reported with a retry hint.

Editing either input, changing athlete, switching mode or submitting again
invalidates the earlier result, and a late response for an earlier selection
is dropped unseen. Live mode and public mode are unchanged: the card is
hidden in both, and public mode still makes no engine request.

### Selecting the effort from the timeline

In Recorded mode the timeline card shows a **Select an effort from the
timeline** toolbar once a window is drawn. Click **Pick effort start** or
**Pick effort end**, then click (or tap) a point on either chart: the
sample's recorded timestamp text, exactly as the engine returned it (offset
included, never interpolated), is copied into the effort form, and arming
moves on to the other bound. The keyboard alternative is the **recorded
points** list, which names every recorded instant in UTC with its heart
rate and speed: choose one and press **Use as start** or **Use as end**.
Typing into the form still works and takes precedence over any earlier pick.

The selected bounds are shown as text (recorded and UTC) under the toolbar
and marked on both charts with dashed bound lines and a shaded span labelled
"selected effort (user selection)" on their shared recorded-time axis. The
shading marks your selection, not a detected sprint or a classification.
Reversed bounds, two picks of the same sample, and durations outside the
engine's 1 to 120 s limits are explained at once, but only as hints: the
form keeps what was picked and the engine's validation decides when you
click **Review effort**. Picking never requests anything; **Review effort**
is always an explicit click.

A selection belongs to the window it was made on. Changing athlete,
reviewing a different window, refreshing the timeline or leaving Recorded
mode clears the selection and its highlighting, so an old selection can
never appear to belong to a new timeline; the effort form keeps its text.
**Clear selection** removes the highlighting without touching the form.
Confidence markers, null heart-rate markers, gap breaks, source labels and
the phone layout are unchanged.

To try it with the fictional fixtures from the engine repository, convert
and replay `fictional_heart_rate.csv` and `fictional_tracking.csv` for
athlete-1 (see the engine README), switch to **Recorded**, enter
`2026-10-20T10:00:04Z` in the review bar and click **Review**, click **Pick
effort start**, click the `10:00:01Z` point on the speed chart, click the
`10:00:04Z` point, then click **Review effort**. Or enter
`2026-10-20T10:00:01Z` and `2026-10-20T10:00:04Z` by hand and click **Review
effort**: movement shows 4 samples, peak 6.0 m/s, 10.5 m over 2.0 s with one
excluded interval and 1.5 s / 8.3 m at or above 5 m/s; heart rate shows
1 measurement before (112), 3 of 4 during (mean 117.8, peak 120.5) and
nothing after.

## Comparing two selected efforts

Below the effort card, Recorded mode has a **Compare two selected efforts**
card with two slots. After a review is displayed, **Save as Comparison A**
or **Save as Comparison B** keeps a deep copy of that exact response (the
buttons are disabled while a review is loading, after it failed, and once
the result is obsolete, so only a current displayed result can be saved).
Each slot shows the athlete, effort bounds and duration, the engine's
capture time, follow-up status, applied rules and reported sources, and the
table lists peak speed, estimated distance, included duration and fraction,
excluded intervals, high-speed time and distance, and the before/during/after
heart-rate measurements, samples, mean and peak for A and B side by side
(stacked on phones) with an arithmetic B − A column where both values are
numbers. A null the engine returned reads "Not available", 0.0 is a real
value, and a context row names differences in duration, applied rules,
follow-up status and sample availability so the numbers are not compared
blindly.

These are two selected snapshots of one athlete that may describe different
workloads and data availability. Nothing is ranked, scored, normalised or
called a baseline, and a difference is never presented as fatigue or
recovery. Saving is always explicit: a new review never replaces a slot by
itself, input edits never change a saved snapshot, and no polling touches
the slots. Either slot can be replaced (Save again) or cleared (Clear A /
Clear B). Both slots are cleared, with a short explanation, when the
athlete changes or you return to Live. Slots live in page memory only.

## Source labels on the engine-connected cards

The engine-connected cards no longer carry fixed "Simulated" badges. Each
card's badge is derived from the data it is showing:

- The two latest-reading cards use the one sample they show: its `source`
  and `device_id`, or "Source not reported" when the sample has none.
- The summary and timeline cards use the `sources` breakdown the engine
  returns with the summary and the window: per stream, how many samples
  reported each source and how many reported none. The badge reads
  "Reported source: simulated" when every sample says so, "Reported source:
  wearable" for a single reported source, "Mixed sources: camera 1,
  wearable 3, not reported 2" for a mixture, "Source not reported" when none
  reported one, "No samples" for an empty window, and "Source information
  unavailable" when the engine response has no breakdown. A line under the
  header repeats the per-stream counts.
- Badges are cleared whenever the athlete, the mode or the review time
  changes, so a label never describes a previous selection.

A source is a label supplied with the sample. The cards repeat it and never
vouch for it: "Reported source: wearable" means the sender said so, not that
the reading came from real hardware or is accurate, and fictional test values
sent with a `wearable` label are still fictional. No live device or camera
integration exists. The browser-generated demonstration panels (the game
simulation, the demo load index and its notes) keep their explicit
"Browser demo · fictional data" labels, which apply only to those panels.

## Live team overview

In engine Live mode a **Live team overview** card sits between the Review
bar and the single-athlete cards. A **Team** selector lists the team ids
found in the registered roster (there is no separate team registry: a team
is whatever `team_id` the athletes were registered with). The page asks the
engine for `GET /api/v1/teams/{team_id}/live` about every 2 seconds while
the dashboard is visible in Live mode, one request per refresh for the
whole team, never one per athlete. **Refresh** asks at once.

Each athlete has a tile with name, jersey number and sport, the newest
retained heart rate and the newest retained speed and tracking confidence,
each with its own age against the engine's captured instant, and the
reported sources of those samples. The three states are kept apart:

- *no sample*: the engine retains nothing for that stream;
- a recent reading: `1.2 s ago`;
- *stopped updating*: a reading older than 5 s, shown with its age and
  marked as a display rule. The 5 s threshold is a freshness label only,
  not a judgment about the athlete or the device.

A null heart rate reads "not reported in sample" and a zero speed reads
`0.0 m/s`.

**Reported device status.** Each tile also lists the device ids named by
the athlete's newest samples (one line per id; an id shared by both streams
appears once with "physiological + tracking") with that device's latest
status report from the engine: "last reported connected 3.0 s ago · battery
72% · signal quality 0.60". The same line appears under the Live Heart Rate
and Live Tracking cards for the selected athlete, taken from the team
response rather than extra requests. The association is only that the
sample named the id: it is a reported association, not a verified identity
or a permanent assignment. A status is a report about its own moment, so the
wording is always "last reported ..." with the report's age; a report older
than 60 s is marked outdated (a display rule), and nothing on the page
infers that a device is connected or disconnected from samples arriving or
stopping. Battery 0% and signal quality 0.00 are real readings; "not
reported" is a null. "No status report received" means the id was named but
no report exists; "no device id reported" means the newest samples named
none. The simulator sends such reports only with `--with-device-status`.

Clicking a tile selects that athlete exactly as the Athlete
selector does and opens the detailed cards. Switching team drops any late
answer for the previous team; an empty team, an unreachable engine and an
HTTP error are shown in the status line and retried on the next refresh;
a roster reload rebuilds the team list and falls back to the first team if
the selected one is gone. The card is hidden and silent in Recorded mode,
refreshes immediately when Live returns, and makes no request in public
mode. Tiles wrap into one column at phone width.

## Live and Recorded review modes

Above the engine-connected cards a **Review** bar switches between two modes.
It is hidden in public mode like the other engine-connected elements.

- **Live** (default): the current-reading cards poll once per second and the
  summary and timeline cards refresh every 5 seconds over the last 60 s of
  engine time. This is the behaviour described above.
- **Recorded**: review the 60 s ending at a time you choose. Enter a window
  end as an ISO 8601 timestamp **with a timezone** (for example
  `2026-10-20T10:00:02Z` or `2026-10-20T12:00:02+02:00`; the hint under the
  control shows the format) and click **Review**. The page asks the engine
  for the summary and the window with `end=<your time>` and the usual 60 s
  duration, using proper query encoding, and shows an amber
  **Recorded-time review** banner with the window bounds the engine returned.
  The summary and timeline are fetched only when you click Review, change
  athlete, or click **Refresh**; no timer advances the window. The live
  current-reading cards are hidden while reviewing, the summary and timeline
  are badged "Recorded-time review", the sample-age rows read "Newest sample
  before selected window end", and a review is never labelled "Live".
  Clicking **Live** restores the cards and polling immediately.

A late response from an earlier athlete, review time or mode can never
overwrite the current display: every request carries the selection generation
it was made for, and a change of athlete, mode or review time bumps it and
clears the cards at once. Null markers, zero values, confidence markers, gap
breaks and the mobile layout behave exactly as in Live mode. An invalid or
timezone-less time is refused on the page with the format hint; a time the
engine refuses (for example one in the future) is shown as
"Engine rejected the request: ..." with the engine's reason.

**Recorded review shows retained samples, not a recording archive.** The
engine keeps only the newest 300 samples per athlete per stream, so a window
can only show what is still stored; older records may already have been
removed, and an empty review window says so.

### Finding retained data

Typing a window end by hand needs you to know when a recording was made. In
Recorded mode a **Retained data** block under the controls removes the
guesswork:

- **Find retained data** asks the engine (`GET /api/v1/athletes/{id}/retained-data`)
  what it currently stores for the selected athlete and shows, per stream,
  the count of retained samples and the recorded timestamps of the oldest
  and newest, in UTC (for example
  `Tracking: 5 retained · 2026-10-20T10:00:00Z → 2026-10-20T10:00:04Z UTC`),
  together with the retention cap. It is fetched only when you click, never
  by a timer, and only in engine mode; public mode still makes no engine
  request.
- **Review latest retained** takes the newest timestamp across the streams
  that retain anything, puts that exact UTC text into the window-end field
  and runs the normal 60 s recorded review ending there. Manual entry,
  Review, Refresh and Live keep working exactly as before, and nothing about
  the recorded timestamps changes: the review is still historical and is
  never shown as live.

While the lookup is loading the button is disabled and the status says so; a
network or HTTP error is shown with the engine address and the button is
re-enabled for a retry. An athlete or mode change clears the block at once,
and a late answer for an earlier athlete, mode or lookup is dropped unseen.

- **Download retained samples** fetches the engine's
  `retained-samples.jsonl` export for the selected athlete and saves it on
  this computer through an ordinary browser download; nothing is uploaded
  anywhere. The file holds every sample the engine currently retains for
  that athlete across **both** streams in the replayable JSON Lines format,
  not just the 60 s review or a selected effort, and can be replayed into
  another local engine with `scripts/replay_samples.py`. It is a snapshot
  of retained rows, not a recording archive or a database backup: samples
  already removed by the newest-300 cap cannot be recovered. The button
  works only in Recorded mode and only on click; while fetching it is
  disabled; "no retained samples" (the engine's 404) and backend or network
  errors are shown with a retry hint; and a response that arrives after the
  athlete, the mode or a newer request changed is discarded without saving,
  so a file never lands under the wrong athlete.

**Counts and ranges describe retained records only.** They are not a session
list, do not show continuous coverage between the bounds, and are not a full
archive: nothing is inferred about gaps or about rows the newest-300 rule has
removed, and an empty stream does not establish whether data was never
collected or has since been removed. The two streams are independent and may
cover different times, so the latest 60 s window may contain only one of
them; the block says which case applies.

To review the fictional replay example from the engine repository: replay it
(`python scripts/replay_samples.py scripts/examples/fictional_replay.jsonl`),
switch to **Recorded**, enter `2026-10-20T10:00:02Z` and click **Review**;
athlete-1 then shows 2 heart-rate samples (one null) and 3 tracking samples
including a real 0.0 m/s, and athlete-2 shows one tracking sample drawn as a
below-confidence marker.

## Tests

The timeline card has behaviour tests in `tests/timeline_confidence.test.html`:
a static page that runs the real engine-connected script from `index.html`
inside a small in-page DOM stub with a controllable `fetch`, so it needs no
test framework, no Node runtime and no running engine (every request the
script makes is captured and answered by the test; all data is fictional).
With the folder served as above, open

    http://localhost:3000/tests/timeline_confidence.test.html

and read the pass/fail list (also logged to the console and exposed as
`window.__results`). It covers: the rule being taken from the window response
with the summary delayed or failed; points below, exactly at and above the
rule; missing or invalid rules; null markers and display-gap breaks; rapid
athlete switching with late responses; backend errors; public mode making
no engine request; and the Recorded review mode (hidden live cards, requests
only on Review/athlete change/Refresh with the encoded `end`, timers never
advancing the window, invalid input refused on the page, engine 422 messages
shown, late responses across time/athlete/mode changes dropped, empty
windows, and returning to Live); and the Retained data block (fetched only
on Find in Recorded mode, counts and UTC ranges shown, Review latest retained
opening the review at the newest end across streams, empty and one-stream
results, network and HTTP errors with retry, and clearing plus stale-response
protection across athlete and mode changes); and the source labels (latest
sample's own source on the live cards, the breakdown-derived badge on the
summary and timeline cards for simulated, single, mixed, not-reported, empty
and unavailable cases, and clearing on athlete, mode and review-time
changes); and the Selected effort review card (Recorded mode only, no
request until Review effort, page validation, the encoded request, a
populated render checked field by field, empty periods, missing movement,
nulls and real zeros, pending follow-up, engine 422 and backend errors,
Refresh re-submitting the same bounds, no polling, and invalidation on
input edits, athlete and mode changes with late responses dropped); and
Download retained samples (click-only request, saving through a download
link with the engine's filename and counts or a safe fallback name, the
no-data 404, HTTP and network errors with retry, and responses for an
earlier athlete, mode or request never being saved); and timeline effort
selection (Recorded mode only, chart clicks copying the sample's recorded
text with offsets intact, shading and bound lines on both charts, no
request until Review effort, reversed/equal/too-short hints, the keyboard
list, typed entry preserved, Clear selection, and clearing on athlete
change, new windows and leaving Recorded mode); and the comparison slots
(explicit saves only, independent deep copies, side-by-side values with
arithmetic differences and context notes, nulls and zeros, replacing and
clearing, no polling, and clearing on athlete change and return to Live
with stale results unsaveable); and the live team overview (team ids from
the roster, one request per refresh, tiles with readings, recency states,
zero speed and sources, tile clicks opening the athlete, team switching
with late responses dropped, empty teams, errors and retries, roster
reloads, and silence in Recorded mode and while hidden); and reported
device status (per-device lines with age, zeros, nulls, outdated and
no-status states on the tiles, and the selected-athlete cards taking their
device line from the team response and clearing it on athlete change).
Expect "47 tests, 47 passed".

## Project handoff

The concise cross-repository handoff (purpose, commands, endpoints,
calculations, limitations, next milestone) lives in the engine repository:
`Athletrix_Vision_Synopsis_2026/PROJECT_STATUS.md`.

## Pointing at a different backend

See "Engine mode and configuration" above: set `apiBase` (and, for a
non-localhost host, `engineMode: "engine"`) in `window.ATHLETRIX_CONFIG`. The
backend's `CORS_ORIGINS` must include the origin the frontend is served from
(`http://localhost:3000` is allowed by default).

## Publishing (assistantcoachai.net)

The public site is served by Netlify from this repository's `main` branch;
there is no build step and no deploy configuration file in the repo, so the
connection lives in the Netlify site settings. Pushing to `main` triggers a
new deploy automatically; allow a minute or two and hard-refresh. Because the
public hostname is not localhost, visitors get public mode and the page makes
no requests to `127.0.0.1`. DNS and hosting settings are not managed here.
