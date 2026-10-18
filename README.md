# Athletrix Web

Marketing site and live demo dashboard for Athletrix. A single static page
(`index.html`) with no build step.

The backend/engine lives in the separate `Athletrix_Vision_Synopsis_2026`
repository. The dashboard's **Live Heart Rate** and **Live Tracking** cards
poll that backend for `athlete-1`; everything else on the page is
self-contained demo data.

## Run the frontend

Serve the folder over HTTP (opening `index.html` directly from disk will not be
allowed to call the backend because of browser CORS rules):

```bash
cd Athletrix_Web
python3 -m http.server 3000
```

Open http://localhost:3000 and click **Open the Live Demo** to reach the
dashboard. The two live cards are at the top of the dashboard.

## Run with the backend and simulator

Three terminals:

```bash
# 1. Backend (from the Athletrix_Vision_Synopsis_2026 repo)
source .venv/bin/activate
uvicorn app.main:app --reload

# 2. Simulator (same repo, sends 60 s of fictional data for athlete-1)
source .venv/bin/activate
python scripts/simulate_athlete.py --with-tracking   # omit the flag for heart rate only

# 3. Frontend (this repo)
python3 -m http.server 3000
```

What the cards show:

- **Live Heart Rate**: heart rate and sample time of the most recent
  physiological sample, with a "Simulated data" badge whenever the sample's
  `source` is `simulated`. A `null` `heart_rate_bpm` is shown as "—", not 0.
- **Live Tracking** (always labelled "Simulated tracking demo"): speed in
  m/s, acceleration in m/s² (signed), tracking confidence as a percentage, and
  sample time of the most recent tracking sample. Zero is a real reading and
  is shown as `0.0 m/s`, never as missing.

Each card polls its own endpoint once per second while the dashboard is
visible and reports its own state independently:

- **No sample yet** if the backend has nothing for `athlete-1` on that stream.
- **Cannot reach backend** if the backend is not running on `127.0.0.1:8000`.
- **Stopped updating** if no new sample has arrived on that stream for 5
  seconds (e.g. the simulator finished).

Each card shows its own sample timestamp. The two streams are polled and
timestamped separately; showing them side by side does not mean they are
synchronized.

## Pointing at a different backend

The backend address defaults to `http://127.0.0.1:8000`. To change it, set
`window.ATHLETRIX_API_BASE` in a script tag placed before the
`axLiveHeartRate` script at the bottom of `index.html`. The backend's
`CORS_ORIGINS` must include the origin the frontend is served from
(`http://localhost:3000` is allowed by default).
