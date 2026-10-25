# Athletrix Web

Marketing site and live demo dashboard for Athletrix. A single static page
(`index.html`) with no build step.

The backend/engine lives in the separate `Athletrix_Vision_Synopsis_2026`
repository. The dashboard's **Live Heart Rate**, **Live Tracking** and
**Last 60 seconds** cards poll that backend for `athlete-1`; everything else
on the page is self-contained demo data.

## Run the frontend

Serve the folder over HTTP (opening `index.html` directly from disk will not be
allowed to call the backend because of browser CORS rules):

```bash
cd Athletrix_Web
python3 -m http.server 3000
```

Open http://localhost:3000 and click **Live Demo** in the top navigation to
reach the dashboard. The **Athlete** selector and the three backend-connected
cards are at the top of the dashboard.

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

# 4. Frontend (this folder)
python3 -m http.server 3000
```

Click path: open http://localhost:3000, click **Live Demo** in the top
navigation, then pick an athlete in the **Athlete** dropdown above the cards.
All three cards switch together. **Refresh roster** reloads the athlete list
from the backend and keeps your current selection when it is still present.

Everything in the backend is process memory: the athlete registry and all
readings clear when the backend restarts, so rerun the roster script (and
the simulators) afterwards. The dashboard will show the empty-roster message
until you do.

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
  `null` values are shown as "Not available"; real zeros are shown as zeros.
  A successful fetch does not mean the data is live: the status line reports
  how old the newest samples were relative to the summary's window end, and
  an empty window says so. These are descriptive numbers only.

The two live cards poll once per second and the summary card every 5
seconds, only while the dashboard is visible, and each reports its own state:

- **No sample yet** / **No samples recorded** if the backend has nothing for
  the selected athlete on that stream or in that window.
- **Cannot reach backend** if the backend is not running on `127.0.0.1:8000`.
- **Stopped updating** (live cards) if no new sample has arrived on that
  stream for 5 seconds (e.g. the simulator finished).

Switching athletes clears all three cards immediately and discards any
response that arrives for the previously selected athlete, so a slow reply
can never appear under another athlete's name. Each card shows its own
sample timestamp; the streams are polled and timestamped separately, so
showing them side by side does not mean they are synchronized.

## Pointing at a different backend

The backend address defaults to `http://127.0.0.1:8000`. To change it, set
`window.ATHLETRIX_API_BASE` in a script tag placed before the
`axLiveHeartRate` script at the bottom of `index.html`. The backend's
`CORS_ORIGINS` must include the origin the frontend is served from
(`http://localhost:3000` is allowed by default).
