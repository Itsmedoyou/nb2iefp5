"""Forecast-vs-actual analysis for GB national wind generation.

Conventions used throughout:
* All timestamps are tz-aware UTC ``pd.Timestamp``s. Delivery days and the
  decision cutoff are defined in UK local time (Europe/London) and converted.
* ``error = forecast - actual`` in MW. Positive error means the forecast was too
  high (over-forecast), i.e. the buyer would have bought too little.
* WINDFOR is hourly and FUELHH is half-hourly. Forecasts are compared with the
  actual for the half-hour that starts on the same hour; no resampling is done
  so every number traces back to a published value.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

LONDON = ZoneInfo("Europe/London")
DEFAULT_CUTOFF = time(9, 20)  # EPEX GB day-ahead auction gate closure, UK time

# Purchase decisions made in January 2026 buy power for delivery 2 Jan - 1 Feb.
DECISION_FIRST = date(2026, 1, 1)
DECISION_LAST = date(2026, 1, 31)

HORIZON_BINS_H = [0, 6, 12, 18, 24, 30, 36, 42, 48, 60, 72]
LEVEL_BINS_MW = [0, 4000, 8000, 12000, 16000, 25000]
MIN_TRAIN_DAYS = 7


@dataclass(frozen=True)
class Dataset:
    actuals: pd.Series  # MW, indexed by half-hour start_time
    forecasts: pd.DataFrame  # publish_time, start_time, forecast (MW)


def load_dataset(data_dir: Path) -> Dataset:
    actuals = pd.read_csv(data_dir / "actuals_wind.csv")
    actuals["startTime"] = pd.to_datetime(actuals["startTime"], utc=True)
    series = actuals.set_index("startTime")["generation"].astype(float).sort_index()
    series.index.name = "start_time"

    fc = pd.read_csv(data_dir / "forecasts_wind.csv")
    fc = pd.DataFrame(
        {
            "publish_time": pd.to_datetime(fc["publishTime"], utc=True),
            "start_time": pd.to_datetime(fc["startTime"], utc=True),
            "forecast": fc["generation"].astype(float),
        }
    ).sort_values(["publish_time", "start_time"], ignore_index=True)
    return Dataset(actuals=series, forecasts=fc)


# --------------------------------------------------------------------------- time


def delivery_dates() -> list[date]:
    n = (DECISION_LAST - DECISION_FIRST).days + 1
    return [DECISION_FIRST + timedelta(days=i + 1) for i in range(n)]


def _local(d: date, t: time) -> pd.Timestamp:
    return pd.Timestamp(datetime.combine(d, t, tzinfo=LONDON)).tz_convert("UTC")


def delivery_window(d: date) -> tuple[pd.Timestamp, pd.Timestamp]:
    """UTC [start, end) of a UK-local delivery day (handles 23/25h clock-change days)."""
    return _local(d, time(0)), _local(d + timedelta(days=1), time(0))


def decision_cutoff(d: date, cutoff: time = DEFAULT_CUTOFF) -> pd.Timestamp:
    """The moment the buyer must commit for delivery day ``d``: ``cutoff`` on D-1, UK time."""
    return _local(d - timedelta(days=1), cutoff)


# ------------------------------------------------------------------- forecast pick


def forecast_as_of(
    forecasts: pd.DataFrame, as_of: pd.Timestamp, start: pd.Timestamp, end: pd.Timestamp
) -> pd.DataFrame:
    """For each target hour in [start, end), the latest forecast published at or before ``as_of``.

    This is the no-look-ahead rule: a forecast published after the decision is
    never used, even if it is more accurate.
    """
    mask = (
        (forecasts["publish_time"] <= as_of)
        & (forecasts["start_time"] >= start)
        & (forecasts["start_time"] < end)
    )
    avail = forecasts.loc[mask]
    if avail.empty:
        return avail.copy()
    latest = avail.loc[avail.groupby("start_time")["publish_time"].idxmax()]
    return latest.sort_values("start_time", ignore_index=True)


def decision_frame(ds: Dataset, cutoff: time = DEFAULT_CUTOFF) -> pd.DataFrame:
    """One row per delivery hour in the January decision window, with the forecast
    the buyer would have used and the outturn."""
    parts = []
    for d in delivery_dates():
        start, end = delivery_window(d)
        picked = forecast_as_of(ds.forecasts, decision_cutoff(d, cutoff), start, end)
        if not picked.empty:
            parts.append(picked.assign(delivery_date=d))
    df = pd.concat(parts, ignore_index=True)
    df["actual"] = df["start_time"].map(ds.actuals)
    df = df.dropna(subset=["actual"]).reset_index(drop=True)
    return _enrich(df)


def horizon_frame(ds: Dataset) -> pd.DataFrame:
    """Every published forecast for a delivery-window hour, with its lead time.

    Used to show how error grows the further ahead a forecast is made.
    """
    start, _ = delivery_window(delivery_dates()[0])
    _, end = delivery_window(delivery_dates()[-1])
    fc = ds.forecasts
    df = fc[(fc["start_time"] >= start) & (fc["start_time"] < end)].copy()
    df["actual"] = df["start_time"].map(ds.actuals)
    df = df.dropna(subset=["actual"])
    df = _enrich(df)
    return df[df["lead_h"] >= 0].reset_index(drop=True)


def _enrich(df: pd.DataFrame) -> pd.DataFrame:
    df["error"] = df["forecast"] - df["actual"]
    df["lead_h"] = (df["start_time"] - df["publish_time"]).dt.total_seconds() / 3600
    df["hour_local"] = df["start_time"].dt.tz_convert(LONDON).dt.hour
    return df


# ------------------------------------------------------------------------ metrics


def error_summary(df: pd.DataFrame) -> dict:
    err = df["error"].to_numpy()
    abs_err = np.abs(err)
    # actual - forecast: how far reality fell short of / exceeded the forecast.
    surprise = -err
    return {
        "n": int(len(err)),
        "mae": float(abs_err.mean()),
        "rmse": float(np.sqrt((err**2).mean())),
        "bias": float(err.mean()),
        "mean_actual": float(df["actual"].mean()),
        "mean_forecast": float(df["forecast"].mean()),
        "nmae": float(abs_err.mean() / df["actual"].mean()),
        "over_forecast_share": float((err > 0).mean()),
        "abs_error_p50": float(np.percentile(abs_err, 50)),
        "abs_error_p90": float(np.percentile(abs_err, 90)),
        "abs_error_p95": float(np.percentile(abs_err, 95)),
        "max_over_forecast": float(err.max()),
        "max_under_forecast": float(err.min()),
        # Quantiles of (actual - forecast); forecast + q gives a planning band.
        "surprise_quantiles": {
            str(q): float(np.percentile(surprise, q)) for q in (5, 10, 25, 50, 75, 90, 95)
        },
    }


def _grouped(df: pd.DataFrame, key) -> list[dict]:
    g = df.groupby(key, observed=True)["error"]
    out = pd.DataFrame(
        {
            "n": g.size(),
            "mae": g.apply(lambda e: e.abs().mean()),
            "bias": g.mean(),
            "abs_error_p90": g.apply(lambda e: e.abs().quantile(0.9)),
        }
    )
    return out.reset_index().to_dict(orient="records")


def by_horizon(hf: pd.DataFrame) -> list[dict]:
    bins = pd.cut(hf["lead_h"], HORIZON_BINS_H, right=False)
    rows = _grouped(hf.assign(bucket=bins), "bucket")
    for r in rows:
        iv = r.pop("bucket")
        r["from_h"], r["to_h"] = int(iv.left), int(iv.right)
    return rows


def by_hour(df: pd.DataFrame) -> list[dict]:
    return [{**r, "hour": int(r.pop("hour_local"))} for r in _grouped(df, "hour_local")]


def by_level(df: pd.DataFrame) -> list[dict]:
    bins = pd.cut(df["forecast"], LEVEL_BINS_MW, right=False)
    rows = _grouped(df.assign(bucket=bins), "bucket")
    for r in rows:
        iv = r.pop("bucket")
        r["from_mw"], r["to_mw"] = int(iv.left), int(iv.right)
    return rows


def daily(df: pd.DataFrame) -> list[dict]:
    g = df.groupby("delivery_date")
    out = pd.DataFrame(
        {
            "mae": g["error"].apply(lambda e: e.abs().mean()),
            "bias": g["error"].mean(),
            "forecast_mwh": g["forecast"].sum(),  # hourly MW x 1h
            "actual_mwh": g["actual"].sum(),
        }
    ).reset_index()
    out["delivery_date"] = out["delivery_date"].astype(str)
    return out.to_dict(orient="records")


def error_histogram(df: pd.DataFrame, width: int = 1000) -> list[dict]:
    err = df["error"]
    lo = int(np.floor(err.min() / width) * width)
    hi = int(np.ceil(err.max() / width) * width) + width
    counts, edges = np.histogram(err, bins=np.arange(lo, hi + 1, width))
    return [
        {"from_mw": int(a), "to_mw": int(b), "count": int(c)}
        for a, b, c in zip(edges[:-1], edges[1:], counts)
    ]


# ---------------------------------------------------------------------- regression


def _design(df: pd.DataFrame) -> np.ndarray:
    return np.column_stack([np.ones(len(df)), df["forecast"] / 1000])


def _ols(df: pd.DataFrame) -> np.ndarray:
    coef, *_ = np.linalg.lstsq(_design(df), df["error"].to_numpy(), rcond=None)
    return coef


def error_regression(df: pd.DataFrame) -> dict:
    """Explain the decision-time error with ``error ~ a + b * forecast_GW``.

    Lead time is deliberately not a regressor: at a fixed cutoff it is perfectly
    collinear with hour of day (see ``by_horizon`` for the horizon effect). Reports in-sample coefficients for interpretation, then a walk-forward test:
    each day is corrected using a model fitted only on earlier days, so no
    information from the future leaks into the evaluation.
    """
    coef = _ols(df)
    resid = df["error"].to_numpy() - _design(df) @ coef
    ss_tot = ((df["error"] - df["error"].mean()) ** 2).sum()
    r2 = 1 - (resid**2).sum() / ss_tot

    days = sorted(df["delivery_date"].unique())
    raw, regr, bias_only = [], [], []
    for i, d in enumerate(days):
        if i < MIN_TRAIN_DAYS:
            continue
        train = df[df["delivery_date"] < d]
        test = df[df["delivery_date"] == d]
        pred = _design(test) @ _ols(train)
        recent_bias = train[train["delivery_date"] >= days[i - MIN_TRAIN_DAYS]]["error"].mean()
        raw.append(test["error"].abs())
        regr.append((test["error"] - pred).abs())
        bias_only.append((test["error"] - recent_bias).abs())

    def mae(chunks: list[pd.Series]) -> float:
        return float(pd.concat(chunks).mean())

    return {
        "formula": "error_MW = intercept + per_GW_forecast * forecast_GW",
        "coefficients": {"intercept": float(coef[0]), "per_GW_forecast": float(coef[1])},
        "r2": float(r2),
        "walk_forward": {
            "test_days": len(days) - MIN_TRAIN_DAYS,
            "train_min_days": MIN_TRAIN_DAYS,
            "mae_raw": mae(raw),
            "mae_bias_corrected": mae(bias_only),
            "mae_regression_corrected": mae(regr),
        },
    }


# ------------------------------------------------------------------------- views


def accuracy_report(ds: Dataset, cutoff: time = DEFAULT_CUTOFF) -> dict:
    df = decision_frame(ds, cutoff)
    hf = horizon_frame(ds)
    return {
        "summary": error_summary(df),
        "by_horizon": by_horizon(hf),
        "by_hour": by_hour(df),
        "by_level": by_level(df),
        "daily": daily(df),
        "histogram": error_histogram(df),
        "regression": error_regression(df),
    }


def day_view(ds: Dataset, d: date, cutoff: time = DEFAULT_CUTOFF) -> dict:
    """Everything the decision screen needs for one delivery day."""
    start, end = delivery_window(d)
    as_of = decision_cutoff(d, cutoff)
    picked = forecast_as_of(ds.forecasts, as_of, start, end).set_index("start_time")

    # Planning band from the month's decision-time error distribution.
    month = decision_frame(ds, cutoff)
    q = error_summary(month)["surprise_quantiles"]
    # Corrected forecast: regression fitted only on days delivered before ``d``.
    history = month[month["delivery_date"] < d]
    coef = _ols(history) if history["delivery_date"].nunique() >= MIN_TRAIN_DAYS else None

    actual = ds.actuals[(ds.actuals.index >= start) & (ds.actuals.index < end)]
    series = []
    for t, a in actual.items():
        row = {"time": t, "actual": a, "forecast": None, "band_low": None, "band_high": None, "corrected": None}
        if t in picked.index:
            f = picked.at[t, "forecast"]
            row.update(forecast=f, band_low=max(f + q["10"], 0.0), band_high=f + q["90"])
            if coef is not None:
                row["corrected"] = f - (coef[0] + coef[1] * f / 1000)
        series.append(row)

    matched = picked.join(actual.rename("actual"), how="inner")
    err = matched["forecast"] - matched["actual"]
    corrected_mae = None
    if coef is not None and len(matched):
        corrected = matched["forecast"] - (coef[0] + coef[1] * matched["forecast"] / 1000)
        corrected_mae = float((corrected - matched["actual"]).abs().mean())

    runs = _runs_for_day(ds.forecasts, start, end, as_of)
    return {
        "delivery_date": d.isoformat(),
        "window_start": start,
        "window_end": end,
        "decision_time": as_of,
        "forecast_publish_times": sorted(picked["publish_time"].unique()),
        "lead_h_min": float((picked.index - picked["publish_time"]).min().total_seconds() / 3600)
        if len(picked)
        else None,
        "lead_h_max": float((picked.index - picked["publish_time"]).max().total_seconds() / 3600)
        if len(picked)
        else None,
        "band_quantiles": {"low": q["10"], "high": q["90"]},
        "correction_available": coef is not None,
        "stats": {
            "hours": int(len(matched)),
            "mae": float(err.abs().mean()) if len(err) else None,
            "bias": float(err.mean()) if len(err) else None,
            "forecast_mwh": float(matched["forecast"].sum()),
            "actual_mwh": float(matched["actual"].sum()),
            "max_over_forecast": float(err.max()) if len(err) else None,
            "max_over_forecast_time": err.idxmax() if len(err) else None,
            "corrected_mae": corrected_mae,
        },
        "series": series,
        **runs,
    }


def _runs_for_day(
    forecasts: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp, as_of: pd.Timestamp
) -> dict:
    """All runs from 30h before the cutoff up to the end of delivery. The UI compares the
    run used with one published a day earlier and the last one before delivery began."""
    fc = forecasts[
        (forecasts["start_time"] >= start)
        & (forecasts["start_time"] < end)
        & (forecasts["publish_time"] >= as_of - pd.Timedelta(hours=30))
        & (forecasts["publish_time"] < end)
    ]
    pts = sorted(fc["publish_time"].unique())
    usable = [p for p in pts if p <= as_of]
    chosen = usable[-1] if usable else None
    runs = [
        {
            "key": f"r{i}",
            "publish_time": p,
            "status": "chosen" if p == chosen else ("before_cutoff" if p <= as_of else "after_cutoff"),
        }
        for i, p in enumerate(pts)
    ]
    key = {r["publish_time"]: r["key"] for r in runs}
    wide = fc.assign(k=fc["publish_time"].map(key)).pivot(index="start_time", columns="k", values="forecast")
    evolution = [{"time": t, **{k: v for k, v in row.items() if pd.notna(v)}} for t, row in wide.iterrows()]
    return {"runs": runs, "evolution": evolution}
