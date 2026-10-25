# Wind Forecast Desk

A web app for a GB energy utility's day-ahead power buying team. It answers two questions about national wind generation for purchase decisions made in **January 2026**:

1. **What did the wind forecast say when we had to decide?** Replays any delivery day and shows the latest Elexon forecast published before the 09:20 UK order deadline on the day before, next to what the wind actually produced.
2. **How far can we trust it?** Measures forecast error across the month: mean absolute error, bias, percentiles, error by forecast horizon / wind level / hour, and a walk-forward-tested correction.

**Live app:** _to be added after deployment_

## Running it

### Docker (one command)

```bash
docker compose up --build
# open http://localhost:8000
```

### Local development

```bash
# Backend (Python 3.12)
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload --port 8000

# Frontend (Node 20), in another terminal
cd frontend
npm install
npm run dev            # http://localhost:5173, proxies /api to :8000
```

### Tests

```bash
cd backend && .venv/bin/python -m pytest          # unit + API tests
cd frontend && npm run build && npx playwright test   # end-to-end, desktop + mobile
# against another deployment: BASE_URL=https://… npx playwright test
```

### Refreshing the data

The January 2026 data is closed history, so a snapshot (~1 MB CSV) is committed in `backend/data/`. To rebuild it from Elexon:

```bash
cd backend && .venv/bin/python scripts/fetch_data.py
```

## Files and directories

```
├── Dockerfile               Multi-stage build: Node builds the UI, Python serves API + UI
├── docker-compose.yml       Local one-command run
├── METHOD.md                Data, calculations, regression and caveats
├── vercel.json              Vercel deployment: static React build + Python API function
├── api/index.py             Vercel serverless entrypoint for the FastAPI app
├── requirements.txt         Python dependencies for the Vercel function
├── backend/
│   ├── app/
│   │   ├── analysis.py      Core logic: forecast selection at decision time, error metrics, regression
│   │   └── main.py          FastAPI endpoints (/api/meta, /api/decision, /api/accuracy) + static UI serving
│   ├── data/                Elexon snapshot: actuals_wind.csv (FUELHH), forecasts_wind.csv (WINDFOR)
│   ├── scripts/fetch_data.py  Downloads the snapshot from the Elexon BMRS API
│   ├── tests/               pytest: analysis unit tests (synthetic data) and API tests (real snapshot)
│   ├── requirements.txt     Runtime dependencies
│   └── requirements-dev.txt Test dependencies
└── frontend/
    ├── src/
    │   ├── App.tsx          Shell, tabs, URL-hash state (shareable links), light/dark toggle
    │   ├── api.ts           Typed API client
    │   ├── format.ts        UK-time and number formatting
    │   ├── theme.css        Design tokens (light/dark), layout
    │   ├── components/ui.tsx  Shared cards, tiles, tooltip, fetch hook
    │   └── pages/           DecisionView, AccuracyView
    ├── e2e/app.spec.ts      Playwright end-to-end tests
    └── playwright.config.ts Runs E2E against FastAPI serving the built UI
```

## How it works

Full details of the data, calculations and caveats are in **[METHOD.md](METHOD.md)**. In short:

| Topic | Choice |
|---|---|
| Data | Elexon BMRS `FUELHH` (fuelType WIND, half-hourly actuals) and `WINDFOR` (hourly forecasts, ~8 runs/day) |
| Scope | Decisions 1–31 Jan 2026 → delivery 2 Jan – 1 Feb 2026 (31 days × 24 h = 744 hours), UK local days |
| Forecast selection | For each delivery hour, the latest forecast with `publishTime ≤ 09:20 UK on D−1` (order deadline). Later runs are never used. In practice this is the 07:30 run. |
| Error | `forecast − actual` in MW; positive = forecast too high (buyer under-buys) |
| Resolution | Each hourly forecast is compared with the actual half-hour starting on that hour |
| Error band | 10th–90th percentile of `actual − forecast` over January (descriptive, in-sample) |
| Correction | `error ≈ a + b × forecast_GW`, fitted per day on earlier days only (walk-forward, ≥ 7 days of history) |

Key findings (09:20 deadline): MAE ≈ 2.0 GW (18% of mean output), bias ≈ +1.7 GW (forecast too high in 85% of hours), 90% of hourly errors within 4.2 GW. Over-forecast grows with forecast level (~190 MW per GW). The walk-forward correction cuts MAE by ~41%.

## Use of AI tools

This project was built with the help of an AI coding assistant (Claude Code), which was used for domain research, data exploration, code generation, tests and documentation. All analysis choices were reviewed and the outputs were verified with automated tests.
