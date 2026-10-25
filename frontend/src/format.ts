// Display helpers. Everything user-facing is shown in UK local time.

const TZ = "Europe/London";

const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const dayLongFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const tzNameFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, timeZoneName: "short" });

export const fmtTime = (iso: string | number) => timeFmt.format(new Date(iso));
export const fmtDay = (iso: string | number) => dayFmt.format(new Date(iso));
export const fmtDayTime = (iso: string) => `${fmtDay(iso)} ${fmtTime(iso)}`;
export const tzName = (iso: string) =>
  tzNameFmt.formatToParts(new Date(iso)).find((p) => p.type === "timeZoneName")?.value ?? "";

/** A delivery date (YYYY-MM-DD) as a long label, e.g. "Thursday 15 January 2026". */
export const fmtDateLong = (ymd: string) => dayLongFmt.format(new Date(`${ymd}T12:00:00Z`));
export const fmtDateShort = (ymd: string) => dayFmt.format(new Date(`${ymd}T12:00:00Z`));

export const mw = (v: number | null | undefined, digits = 0) =>
  v == null ? "–" : `${v.toLocaleString("en-GB", { maximumFractionDigits: digits })} MW`;
export const num = (v: number, digits = 0) => v.toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits });
export const gw = (v: number, digits = 1) => `${num(v / 1000, digits)} GW`;
export const gwh = (mwh: number) => `${num(mwh / 1000, 0)} GWh`;
export const pct = (v: number, digits = 0) => `${num(v * 100, digits)}%`;
export const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString("en-GB")}`;
export const axisGw = (v: number) => `${(v / 1000).toLocaleString("en-GB", { maximumFractionDigits: 2 })} GW`;

// Plain-language comparison of forecast against actual. `diff` is forecast − actual (MW).
// Used everywhere so the buyer always sees which side was higher.
export const vsActual = (diff: number, unit = "MW") =>
  Math.round(diff) === 0
    ? "the same as actual"
    : `${Math.abs(Math.round(diff)).toLocaleString("en-GB")} ${unit} ${diff > 0 ? "higher" : "lower"} than actual`;
