"""End-to-end API tests against the committed January 2026 snapshot."""

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app import analysis as A
from app.main import app, dataset

client = TestClient(app)


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}


def test_meta_lists_31_delivery_days():
    body = client.get("/api/meta").json()
    assert len(body["delivery_dates"]) == 31
    assert body["default_cutoff"] == "09:20"


def test_decision_uses_0730_run_for_0920_cutoff():
    body = client.get("/api/decision", params={"date": "2026-01-15"}).json()
    assert body["decision_time"] == "2026-01-14T09:20:00Z"
    assert body["forecast_publish_times"] == ["2026-01-14T07:30:00Z"]
    assert len(body["series"]) == 48  # half-hourly actuals for the day
    assert sum(r["forecast"] is not None for r in body["series"]) == 24  # hourly forecast
    chosen = [r for r in body["runs"] if r["status"] == "chosen"]
    assert [r["publish_time"] for r in chosen] == ["2026-01-14T07:30:00Z"]
    assert all(r["publish_time"] > body["decision_time"] for r in body["runs"] if r["status"] == "after_cutoff")


def test_decision_cutoff_changes_selected_run():
    body = client.get("/api/decision", params={"date": "2026-01-15", "cutoff": "12:00"}).json()
    assert body["forecast_publish_times"] == ["2026-01-14T11:30:00Z"]


def test_band_contains_forecast():
    body = client.get("/api/decision", params={"date": "2026-01-20"}).json()
    for r in body["series"]:
        if r["forecast"] is not None:
            assert r["band_low"] <= r["forecast"] <= r["band_high"]


def test_correction_only_after_enough_history():
    early = client.get("/api/decision", params={"date": "2026-01-03"}).json()
    late = client.get("/api/decision", params={"date": "2026-01-25"}).json()
    assert early["correction_available"] is False
    assert late["correction_available"] is True and late["stats"]["corrected_mae"] is not None


@pytest.mark.parametrize("params,status", [({"date": "2026-03-01"}, 404), ({"date": "2026-01-15", "cutoff": "25:00"}, 422), ({}, 422)])
def test_decision_validation(params, status):
    assert client.get("/api/decision", params=params).status_code == status


def test_accuracy_report_shape_and_consistency():
    body = client.get("/api/accuracy").json()
    s = body["summary"]
    assert s["n"] == 31 * 24
    assert s["mae"] >= abs(s["bias"])
    assert sum(b["count"] for b in body["histogram"]) == s["n"]
    assert sum(r["n"] for r in body["by_hour"]) == s["n"]
    assert len(body["daily"]) == 31
    wf = body["regression"]["walk_forward"]
    assert wf["test_days"] == 31 - A.MIN_TRAIN_DAYS


def test_horizon_error_grows_with_lead_time():
    rows = client.get("/api/accuracy").json()["by_horizon"]
    assert rows[0]["mae"] < rows[-1]["mae"]


def test_walk_forward_has_no_look_ahead():
    """Corrupting actuals from day d onwards must not change the correction for day d."""
    ds = dataset()
    d = pd.Timestamp("2026-01-20").date()
    base = A.day_view(ds, d)
    start, _ = A.delivery_window(d)
    tampered = A.Dataset(
        actuals=ds.actuals.where(ds.actuals.index < start, ds.actuals * 10),
        forecasts=ds.forecasts,
    )
    after = A.day_view(tampered, d)
    assert [r["corrected"] for r in base["series"]] == [r["corrected"] for r in after["series"]]
