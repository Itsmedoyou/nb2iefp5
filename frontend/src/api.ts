// Typed client for the FastAPI backend. Timestamps are ISO-8601 UTC strings.

export interface Meta {
  delivery_dates: string[];
  default_cutoff: string;
  sources: { actuals: string; forecasts: string };
  rows: { actuals: number; forecasts: number };
  forecast_runs: number;
}

export interface SeriesPoint {
  time: string;
  actual: number;
  forecast: number | null;
  band_low: number | null;
  band_high: number | null;
  corrected: number | null;
}

export interface Run {
  key: string;
  publish_time: string;
  status: "chosen" | "before_cutoff" | "after_cutoff";
}

export interface DayView {
  delivery_date: string;
  window_start: string;
  window_end: string;
  decision_time: string;
  forecast_publish_times: string[];
  lead_h_min: number | null;
  lead_h_max: number | null;
  band_quantiles: { low: number; high: number };
  correction_available: boolean;
  stats: {
    hours: number;
    mae: number | null;
    bias: number | null;
    forecast_mwh: number;
    actual_mwh: number;
    max_over_forecast: number | null;
    max_over_forecast_time: string | null;
    corrected_mae: number | null;
  };
  series: SeriesPoint[];
  runs: Run[];
  evolution: ({ time: string } & Record<string, number | string>)[];
}

export interface Bucket {
  n: number;
  mae: number;
  bias: number;
  abs_error_p90: number;
}

export interface Accuracy {
  summary: {
    n: number;
    mae: number;
    rmse: number;
    bias: number;
    mean_actual: number;
    mean_forecast: number;
    nmae: number;
    over_forecast_share: number;
    abs_error_p50: number;
    abs_error_p90: number;
    abs_error_p95: number;
    max_over_forecast: number;
    max_under_forecast: number;
    surprise_quantiles: Record<string, number>;
  };
  by_horizon: (Bucket & { from_h: number; to_h: number })[];
  by_hour: (Bucket & { hour: number })[];
  by_level: (Bucket & { from_mw: number; to_mw: number })[];
  daily: { delivery_date: string; mae: number; bias: number; forecast_mwh: number; actual_mwh: number }[];
  histogram: { from_mw: number; to_mw: number; count: number }[];
  regression: {
    formula: string;
    coefficients: { intercept: number; per_GW_forecast: number };
    r2: number;
    walk_forward: {
      test_days: number;
      train_min_days: number;
      mae_raw: number;
      mae_bias_corrected: number;
      mae_regression_corrected: number;
    };
  };
}

const BASE = import.meta.env.VITE_API_BASE ?? "";

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.json() as Promise<T>;
}

export const api = {
  meta: () => get<Meta>("/api/meta"),
  // The order deadline is fixed at 09:20 UK on D-1 (the backend default).
  decision: (date: string) => get<DayView>("/api/decision", { date }),
  accuracy: () => get<Accuracy>("/api/accuracy"),
};
