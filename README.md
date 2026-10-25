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
  physiological sample for the selected athlete, with a "Simulated data"
  badge whenever the sample's `source` is `simulated`. A `null`
  `heart_rate_bpm` is shown as "—", not 0.
- **Live Tracking** (always labelled "Simulated tracking demo"): speed in
  m/s, acceleration in m/s² (signed), tracking confidence as a percentage, and
  sample time of the most recent tracking sample. Zero is a real reading and
  is shown as `0.0 m/s`, never as missing.
- **Last 60 seconds** (labelled "Simulated demo"): fetched every 5 seconds
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
athlete switching with late responses; backend errors; and public mode making
no engine request.

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
