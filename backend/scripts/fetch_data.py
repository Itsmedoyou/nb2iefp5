"""Download the Elexon BMRS datasets used by the app and save them as CSV snapshots.

Usage (from backend/):  python scripts/fetch_data.py

January 2026 is a closed historical window, so the app ships with a committed
snapshot instead of calling Elexon at request time. Re-run this script to
rebuild the snapshot from source.
"""

from __future__ import annotations

import csv
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# Decisions made 1-31 Jan 2026 buy power for delivery 2 Jan - 1 Feb 2026.
# The windows below are padded so every forecast run that could target the
# delivery window (horizons up to ~3 days) and every actual is included.
ACTUALS_QUERY = {
    "settlementDateFrom": "2026-01-01",
    "settlementDateTo": "2026-02-02",
    "fuelType": "WIND",
}
FORECASTS_QUERY = {
    "publishDateTimeFrom": "2025-12-28T00:00:00Z",
    "publishDateTimeTo": "2026-02-02T00:00:00Z",
}


def fetch(dataset: str, params: dict[str, str]) -> list[dict]:
    url = f"{BASE_URL}/{dataset}/stream?{urllib.parse.urlencode(params)}"
    print(f"GET {url}", file=sys.stderr)
    with urllib.request.urlopen(url, timeout=120) as resp:
        return json.load(resp)


def write_csv(path: Path, rows: list[dict], fields: list[str]) -> None:
    rows = sorted(rows, key=lambda r: tuple(r[f] for f in fields))
    with path.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {len(rows):>6} rows -> {path}", file=sys.stderr)


def main() -> None:
    DATA_DIR.mkdir(exist_ok=True)

    actuals = [r for r in fetch("FUELHH", ACTUALS_QUERY) if r["fuelType"] == "WIND"]
    write_csv(DATA_DIR / "actuals_wind.csv", actuals, ["startTime", "generation"])

    forecasts = fetch("WINDFOR", FORECASTS_QUERY)
    write_csv(DATA_DIR / "forecasts_wind.csv", forecasts, ["publishTime", "startTime", "generation"])


if __name__ == "__main__":
    main()
