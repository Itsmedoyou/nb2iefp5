"""HTTP API. Thin layer: parse/validate input, call ``analysis``, serialise output."""

from __future__ import annotations

import math
import os
from datetime import date, datetime, time
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import analysis

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
STATIC_DIR = Path(os.environ.get("STATIC_DIR", Path(__file__).resolve().parent.parent / "static"))

app = FastAPI(title="Wind Forecast Desk API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

CutoffParam = Query("09:20", pattern=r"^([01]\d|2[0-3]):[0-5]\d$", description="Decision time on D-1, UK local (HH:MM)")


@lru_cache(maxsize=1)
def dataset() -> analysis.Dataset:
    return analysis.load_dataset(DATA_DIR)


@lru_cache(maxsize=32)
def _accuracy(cutoff: time) -> dict:
    return jsonable(analysis.accuracy_report(dataset(), cutoff))


def jsonable(obj):
    """Convert pandas/numpy values to plain JSON types; timestamps become ISO-8601 UTC."""
    if isinstance(obj, dict):
        return {str(k): jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(v) for v in obj]
    if isinstance(obj, (pd.Timestamp, datetime)):
        return pd.Timestamp(obj).tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        return None if math.isnan(obj) else round(float(obj), 3)
    return obj


def _parse_cutoff(value: str) -> time:
    h, m = value.split(":")
    return time(int(h), int(m))


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/meta")
def meta() -> dict:
    ds = dataset()
    return jsonable(
        {
            "delivery_dates": [d.isoformat() for d in analysis.delivery_dates()],
            "default_cutoff": analysis.DEFAULT_CUTOFF.strftime("%H:%M"),
            "sources": {
                "actuals": "Elexon BMRS FUELHH (fuelType=WIND), half-hourly",
                "forecasts": "Elexon BMRS WINDFOR, hourly, ~8 runs/day",
            },
            "rows": {"actuals": len(ds.actuals), "forecasts": len(ds.forecasts)},
            "forecast_runs": int(ds.forecasts["publish_time"].nunique()),
        }
    )


@app.get("/api/decision")
def decision(date_: date = Query(..., alias="date"), cutoff: str = CutoffParam) -> dict:
    if date_ not in analysis.delivery_dates():
        raise HTTPException(404, f"{date_} is outside the January 2026 decision window")
    return jsonable(analysis.day_view(dataset(), date_, _parse_cutoff(cutoff)))


@app.get("/api/accuracy")
def accuracy(cutoff: str = CutoffParam) -> dict:
    return _accuracy(_parse_cutoff(cutoff))


# Serve the built React app when present (single-container deployment).
if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        file = STATIC_DIR / path
        return FileResponse(file if path and file.is_file() else STATIC_DIR / "index.html")
