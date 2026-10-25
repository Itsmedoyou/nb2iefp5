from datetime import date, time

import pandas as pd
import pytest

from app import analysis as A


def ts(s: str) -> pd.Timestamp:
    return pd.Timestamp(s, tz="UTC")


@pytest.fixture
def forecasts() -> pd.DataFrame:
    # Three runs for the same two target hours, published before and after a 09:20 cutoff.
    rows = [
        ("2026-01-14T04:30", "2026-01-15T10:00", 100),
        ("2026-01-14T04:30", "2026-01-15T11:00", 110),
        ("2026-01-14T07:30", "2026-01-15T10:00", 200),
        ("2026-01-14T07:30", "2026-01-15T11:00", 210),
        ("2026-01-14T09:30", "2026-01-15T10:00", 300),
        ("2026-01-14T09:30", "2026-01-15T11:00", 310),
    ]
    return pd.DataFrame(
        [{"publish_time": ts(p), "start_time": ts(s), "forecast": float(v)} for p, s, v in rows]
    )


def test_forecast_as_of_picks_latest_run_before_cutoff(forecasts):
    start, end = A.delivery_window(date(2026, 1, 15))
    picked = A.forecast_as_of(forecasts, A.decision_cutoff(date(2026, 1, 15)), start, end)
    assert picked["forecast"].tolist() == [200.0, 210.0]
    assert set(picked["publish_time"]) == {ts("2026-01-14T07:30")}


def test_forecast_as_of_never_uses_later_runs(forecasts):
    start, end = A.delivery_window(date(2026, 1, 15))
    picked = A.forecast_as_of(forecasts, ts("2026-01-14T09:29"), start, end)
    assert (picked["publish_time"] <= ts("2026-01-14T09:29")).all()


def test_forecast_published_exactly_at_cutoff_is_usable(forecasts):
    start, end = A.delivery_window(date(2026, 1, 15))
    picked = A.forecast_as_of(forecasts, ts("2026-01-14T09:30"), start, end)
    assert picked["forecast"].tolist() == [300.0, 310.0]


def test_forecast_as_of_empty_when_nothing_published(forecasts):
    start, end = A.delivery_window(date(2026, 1, 15))
    assert A.forecast_as_of(forecasts, ts("2026-01-01T00:00"), start, end).empty


def test_cutoff_is_uk_local_time():
    # January: GMT == UTC. July: BST == UTC+1, so 09:20 local is 08:20 UTC.
    assert A.decision_cutoff(date(2026, 1, 15)) == ts("2026-01-14T09:20")
    assert A.decision_cutoff(date(2026, 7, 15)) == ts("2026-07-14T08:20")
    assert A.decision_cutoff(date(2026, 1, 15), time(6, 0)) == ts("2026-01-14T06:00")


def test_delivery_window_handles_clock_change():
    start, end = A.delivery_window(date(2026, 3, 29))  # clocks go forward: 23h day
    assert (end - start) == pd.Timedelta(hours=23)


def test_delivery_dates_cover_january_decisions():
    days = A.delivery_dates()
    assert days[0] == date(2026, 1, 2) and days[-1] == date(2026, 2, 1) and len(days) == 31


def test_error_sign_positive_means_over_forecast():
    df = pd.DataFrame({"forecast": [120.0, 80.0], "actual": [100.0, 100.0]})
    s = A.error_summary(df.assign(error=df["forecast"] - df["actual"]))
    assert s["bias"] == 0 and s["mae"] == 20 and s["over_forecast_share"] == 0.5
