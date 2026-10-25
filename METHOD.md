# Method and data

How every number in Wind Forecast Desk is produced. The logic lives in [`backend/app/analysis.py`](backend/app/analysis.py).

## 1. Data

| Dataset | Source | Content | Resolution |
|---|---|---|---|
| Actual wind generation | Elexon BMRS [`FUELHH`](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream), `fuelType = WIND` | `startTime`, `generation` (MW) | Half-hourly |
| Wind forecasts | Elexon BMRS [`WINDFOR`](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream) | `publishTime`, `startTime`, `generation` (MW) | Hourly, about 8 forecast runs per day |

- Both are national GB totals in MW.
- Each forecast run (one `publishTime`) covers a window from the previous evening to roughly 3 days ahead, so a given hour is forecast many times.
- January 2026 is closed history, so a snapshot (~1 MB CSV) is committed in `backend/data/` and loaded into memory at start-up. `backend/scripts/fetch_data.py` rebuilds it from the API.

## 2. Scope

- The brief covers **purchase decisions made in January 2026**. A decision on day D−1 buys power for day D, so the delivery days are **2 January – 1 February 2026**.
- That gives 31 delivery days × 24 hours = **744 hours** analysed.
- Delivery days are UK local days (Europe/London). All timestamps are stored in UTC and converted for display. The clock-change days in spring and autumn (23 and 25 hours) are handled.

## 3. Which forecast was available

- Orders for day D must be submitted by **09:20 UK time on D−1**, when the EPEX GB day-ahead auction closes.
- For every delivery hour, the app uses the **latest forecast with `publishTime ≤ 09:20 on D−1`**.
- Forecasts published after the deadline are never used, even when they are more accurate (no look-ahead).
- Forecasts are published at fixed times (02:30, 04:30, 07:30, 09:30, …). So whenever the desk actually decides between 07:30 and 09:20, the newest forecast it can see is the **07:30** run. The exact moment of the decision does not change the result.
- The API accepts an optional `cutoff=HH:MM` parameter for what-if analysis. The UI always uses 09:20.

## 4. How error is measured

- `error = forecast − actual` in MW.
  - **Positive** = forecast too high → the desk buys too little and must cover the gap later, at a higher price.
  - **Negative** = forecast too low → the desk buys more than it needed.
- Forecasts are hourly and actuals half-hourly. Each forecast hour is compared with the **actual half-hour starting on that hour**. Nothing is resampled, so every value traces back to a published figure.

| Metric | Meaning |
|---|---|
| MAE | Mean absolute error: the typical size of a miss |
| Bias | Mean error: positive means systematically too high |
| RMSE | Root mean squared error: penalises large misses more |
| P90 / P95 absolute error | 90% / 95% of hourly misses are smaller than this |
| Over-forecast share | Share of hours where the forecast was too high |
| "Plan for X MW less" | 10th percentile of `actual − forecast`: in 9 hours out of 10, actual wind was at least `forecast − X` |

The breakdowns on the accuracy page:
- **By horizon:** every forecast run for the delivery window, grouped by `startTime − publishTime`. This shows how error grows the further ahead a forecast is made.
- **By forecast level and by delivery day:** use the forecast available at the deadline.

## 5. Error band

The 80% band on the replay chart is `forecast + [P10, P90]` of `actual − forecast` over the whole month. It **describes January** and is not an out-of-sample prediction.

## 6. Regression and correction

Model: `error = a + b × forecast_GW`, fitted by ordinary least squares.

- **Interpretation (all of January):** b ≈ 190 MW per GW. The more wind is forecast, the more it overshoots. R² ≈ 0.27.
- **Lead time is not used as a regressor.** With a fixed 09:20 deadline, lead time and hour of day move in exact step (correlation = 1), so their effects cannot be separated. The horizon breakdown covers the lead-time effect instead.
- **Walk-forward test:** for each delivery day from the 8th onward, the model is fitted only on days already delivered, then applied to that day. No data from the day itself or later is used; this is checked by a unit test that corrupts future data.

| Forecast | MAE over the 24 test days |
|---|---|
| Raw Elexon forecast | 2,071 MW |
| Minus the last 7 days' average bias | 1,497 MW |
| Level-aware regression correction | 1,231 MW (−41%) |

The app shows only the first and last rows to keep the screen simple. The regression and the 80% band shown in the app are fitted on the whole of January, so they describe the month; only the walk-forward figures estimate future performance.

## 7. Caveats

- **Systematic over-forecast:** the forecast runs about 1.7 GW above actual output, even a few hours ahead. That is too large to be weather error alone. Likely causes:
  - the two datasets may cover different sets of wind farms (for example, wind farms not metered on the transmission network);
  - wind farms being told to reduce output (curtailment), which lowers actual output but not the forecast.

  Both are worth confirming with Elexon.
- **Small sample:** one winter month. Errors in other seasons may differ.
- **No demand data:** the app reports wind forecast quality only. Purchase volumes are left to the desk.

## 8. Key results (09:20 deadline)

| | Value |
|---|---|
| Hours analysed | 744 |
| MAE | 2,022 MW (18% of mean actual output, 11,286 MW) |
| Bias | +1,746 MW |
| Forecast too high | 85% of hours |
| 90% of misses within | 4,154 MW |
| Worst over-forecast / under-forecast | +6,894 MW / −3,389 MW |
