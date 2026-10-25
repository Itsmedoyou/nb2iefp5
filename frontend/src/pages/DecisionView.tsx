import { useEffect, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Accuracy, api, DayView } from "../api";
import { Card, ColourKey, Swatch, Tile, TooltipBox, useFetch } from "../components/ui";
import { axisGw, fmtDateLong, fmtDateShort, fmtDayTime, fmtTime, gwh, mw, num, tzName, vsActual } from "../format";

interface Props {
  dates: string[];
  date: string;
  onDate: (d: string) => void;
}

export default function DecisionView({ dates, date, onDate }: Props) {
  const day = useFetch(() => api.decision(date), [date]);
  const month = useFetch(() => api.accuracy(), []);
  const idx = dates.indexOf(date);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "ArrowLeft" && idx > 0) onDate(dates[idx - 1]);
      if (e.key === "ArrowRight" && idx < dates.length - 1) onDate(dates[idx + 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, dates, onDate]);

  return (
    <>
      <div className="page-head">
        <h1>Decision replay</h1>
        <p>
          Pick a delivery day to see the latest wind forecast your desk could use before the 09:20 order deadline the day before, and how
          it compared with what the wind actually delivered.
        </p>
      </div>

      <div className="controls">
        <div className="field">
          <span>Delivery day</span>
          <div className="date-nav">
            <button type="button" aria-label="Previous day" disabled={idx <= 0} onClick={() => onDate(dates[idx - 1])}>
              ‹
            </button>
            <select aria-label="Delivery day" value={date} onChange={(e) => onDate(e.target.value)}>
              {dates.map((d) => (
                <option key={d} value={d}>
                  {fmtDateLong(d)}
                </option>
              ))}
            </select>
            <button type="button" aria-label="Next day" disabled={idx >= dates.length - 1} onClick={() => onDate(dates[idx + 1])}>
              ›
            </button>
          </div>
        </div>
      </div>

      <ColourKey />

      {month.data && <DayStrip dates={dates} daily={month.data.daily} current={date} onPick={onDate} />}

      {day.error && <p className="error">Could not load day: {day.error}</p>}
      {day.data && (
        <div className={day.loading ? "loading" : undefined} style={{ display: "grid", gap: 20 }}>
          <DecisionBanner d={day.data} />
          <DayTiles d={day.data} />
          <ForecastChart d={day.data} />
          <EvolutionChart d={day.data} />
          <HourlyTable d={day.data} />
        </div>
      )}
    </>
  );
}

function DayStrip({ dates, daily, current, onPick }: { dates: string[]; daily: Accuracy["daily"]; current: string; onPick: (d: string) => void }) {
  const byDate = new Map(daily.map((r) => [r.delivery_date, r]));
  const maxAbs = Math.max(...daily.map((r) => Math.abs(r.bias)), 1);
  return (
    <Card title="January at a glance" sub="Each cell is a delivery day, coloured by how far the forecast used was off on average. Click a day to replay it.">
      <div className="strip" role="list" data-testid="day-strip">
        {dates.map((d) => {
          const r = byDate.get(d);
          const share = r ? Math.min(Math.abs(r.bias) / maxAbs, 1) * 80 : 0;
          const pole = r && r.bias > 0 ? "var(--div-over)" : "var(--div-under)";
          return (
            <button
              key={d}
              role="listitem"
              type="button"
              aria-current={d === current}
              title={r ? `${fmtDateShort(d)} · on average ${vsActual(r.bias)} · average miss ${num(r.mae)} MW` : d}
              style={{ background: `color-mix(in oklab, ${pole} ${share}%, var(--surface-2))` }}
              onClick={() => onPick(d)}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
      <div className="strip-legend">
        <span>2 Jan → 1 Feb 2026 delivery</span>
        <span className="scale">
          Forecast lower than actual <i /> Forecast higher than actual
        </span>
      </div>
    </Card>
  );
}

function DecisionBanner({ d }: { d: DayView }) {
  const pub = d.forecast_publish_times;
  const used = pub.length ? pub.map((p) => fmtDayTime(p)).join(", ") : "No forecast available";
  return (
    <div className="banner" data-testid="decision-banner">
      <div>
        <span className="k">Delivery day</span>
        <span className="v">{fmtDateLong(d.delivery_date)}</span>
      </div>
      <div>
        <span className="k">Order deadline (market close)</span>
        <span className="v">
          {fmtDayTime(d.decision_time)} {tzName(d.decision_time)}
        </span>
      </div>
      <div>
        <span className="k">Latest forecast available before deadline</span>
        <span className="v" data-testid="forecast-used">
          Published {used}
        </span>
      </div>
    </div>
  );
}

function DayTiles({ d }: { d: DayView }) {
  const s = d.stats;
  const diff = s.forecast_mwh - s.actual_mwh;
  // Biggest miss in either direction, from the hourly forecast/actual pairs.
  const biggest = d.series
    .filter((p) => p.forecast != null)
    .reduce<{ time: string; diff: number } | null>((best, p) => {
      const e = p.forecast! - p.actual;
      return !best || Math.abs(e) > Math.abs(best.diff) ? { time: p.time, diff: e } : best;
    }, null);
  return (
    <div className="tiles day-tiles">
      <Tile label="Forecast wind energy" value={gwh(s.forecast_mwh)} hint="What the forecast used expected for the day" testId="tile-forecast" />
      <Tile label="Actual wind energy" value={gwh(s.actual_mwh)} hint="What the wind actually produced" testId="tile-actual" />
      <Tile
        label="Difference for the day"
        wide
        value={gwh(Math.abs(diff))}
        badge={
          s.forecast_mwh ? (
            <>
              <b>{num((Math.abs(diff) / s.forecast_mwh) * 100)}%</b> of forecast
            </>
          ) : undefined
        }
        hint={
          <>
            <span className={`pill ${diff > 0 ? "over" : "under"}`}>
              {diff > 0 ? "▲ forecast higher than actual" : "▼ forecast lower than actual"}
            </span>
            <div style={{ marginTop: 4 }}>
              {diff > 0
                ? `The wind produced ${gwh(diff)} less than forecast. That shortfall had to be bought at the last minute.`
                : `The wind produced ${gwh(-diff)} more than forecast. That much power was bought but not needed.`}
            </div>
          </>
        }
        testId="tile-diff"
      />
      <Tile
        label="Average miss per hour"
        value={num(s.mae ?? 0)}
        unit="MW"
        hint={`On average, forecast ${vsActual(s.bias ?? 0)}`}
        testId="tile-mae"
      />
      <Tile
        label="Biggest miss"
        value={biggest ? num(Math.abs(biggest.diff)) : "—"}
        unit={biggest ? "MW" : undefined}
        hint={biggest ? `at ${fmtTime(biggest.time)}, forecast ${biggest.diff > 0 ? "higher" : "lower"} than actual` : undefined}
        testId="tile-biggest"
      />
    </div>
  );
}

function ForecastChart({ d }: { d: DayView }) {
  const [show, setShow] = useState({ band: true, corrected: false });
  const data = useMemo(
    () => d.series.map((p) => ({ ...p, t: Date.parse(p.time), band: p.band_low != null ? [p.band_low, p.band_high] : null })),
    [d],
  );
  const start = Date.parse(d.window_start);
  const end = Date.parse(d.window_end);
  const ticks = Array.from({ length: Math.round((end - start) / 10_800_000) + 1 }, (_, i) => start + i * 10_800_000);

  return (
    <Card
      testId="forecast-chart"
      title="Forecast used vs actual wind"
      sub={
        <>
          Shaded area: where the actual wind usually landed, given the forecast (8 hours out of 10 in January).
        </>
      }
      actions={
        <div className="legend">
          <span>
            <Swatch color="var(--series-forecast)" /> Forecast used
          </span>
          <span>
            <Swatch color="var(--series-actual)" /> Actual
          </span>
          <label>
            <input type="checkbox" checked={show.band} onChange={(e) => setShow({ ...show, band: e.target.checked })} />
            <Swatch color="var(--band)" box /> 80% band
          </label>
          <label>
            <input
              type="checkbox"
              checked={show.corrected}
              disabled={!d.correction_available}
              onChange={(e) => setShow({ ...show, corrected: e.target.checked })}
            />
            <Swatch color="var(--series-corrected)" /> Corrected forecast
          </label>
        </div>
      }
    >
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="t" type="number" domain={[start, end]} ticks={ticks} tickFormatter={fmtTime} stroke="var(--axis)" />
          <YAxis
            tickFormatter={axisGw}
            stroke="var(--axis)"
            width={64}
          />
          <Tooltip
            cursor={{ stroke: "var(--axis)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof data)[number];
              const rows = [
                { label: "Actual", value: mw(p.actual), color: "var(--series-actual)" },
                ...(p.forecast != null
                  ? [
                      { label: "Forecast", value: mw(p.forecast), color: "var(--series-forecast)" },
                      { label: "Forecast vs actual", value: vsActual(p.forecast - p.actual) },
                      { label: "80% band", value: `${num(p.band_low!)}–${num(p.band_high!)}` },
                    ]
                  : [{ label: "Forecast", value: "hourly only" }]),
                ...(p.corrected != null ? [{ label: "Corrected", value: mw(p.corrected), color: "var(--series-corrected)" }] : []),
              ];
              return <TooltipBox title={`${fmtTime(p.t)} ${tzName(p.time)}`} rows={rows} />;
            }}
          />
          {show.band && <Area dataKey="band" stroke="none" fill="var(--band)" connectNulls isAnimationActive={false} />}
          <Line dataKey="forecast" stroke="var(--series-forecast)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          {show.corrected && d.correction_available && (
            <Line dataKey="corrected" stroke="var(--series-corrected)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          )}
          <Line dataKey="actual" stroke="var(--series-actual)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  );
}

interface CompareLine {
  key: string;
  label: string;
  publishTime: string;
  color: string;
  width: number;
  mae: number | null;
}

/** Pick the three forecasts worth comparing: one a day earlier, the one used, and the
 *  last one published before delivery began (too late to use). */
function compareLines(d: DayView): CompareLine[] {
  const chosen = d.runs.find((r) => r.status === "chosen");
  if (!chosen) return [];
  const chosenAt = Date.parse(chosen.publish_time);
  const before = d.runs.filter((r) => r.status === "before_cutoff");
  const dayEarlier = before.reduce<(typeof before)[number] | undefined>(
    (best, r) =>
      !best || Math.abs(Date.parse(r.publish_time) - (chosenAt - 86_400_000)) < Math.abs(Date.parse(best.publish_time) - (chosenAt - 86_400_000)) ? r : best,
    undefined,
  );
  const lastBeforeDelivery = d.runs.filter((r) => r.status === "after_cutoff" && r.publish_time < d.window_start).pop();

  const actual = new Map(d.series.map((p) => [p.time, p.actual]));
  const mae = (key: string) => {
    const errs = d.evolution.filter((r) => r[key] != null && actual.has(r.time)).map((r) => Math.abs((r[key] as number) - actual.get(r.time)!));
    return errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null;
  };
  const line = (run: DayView["runs"][number], label: string, color: string, width: number): CompareLine => ({
    key: run.key,
    label,
    publishTime: run.publish_time,
    color,
    width,
    mae: mae(run.key),
  });

  return [
    ...(dayEarlier ? [line(dayEarlier, "Forecast a day earlier", "var(--run-earlier)", 2)] : []),
    line(chosen, "Forecast used", "var(--series-forecast)", 2.5),
    ...(lastBeforeDelivery
      ? [line(lastBeforeDelivery, "Last forecast before delivery (too late)", "var(--run-after)", 2)]
      : []),
  ];
}

function EvolutionChart({ d }: { d: DayView }) {
  const lines = compareLines(d);
  const actualByTime = new Map(d.series.map((p) => [p.time, p.actual]));
  const data = d.evolution.map((r) => ({ ...r, t: Date.parse(r.time), actual: actualByTime.get(r.time) }));
  const start = Date.parse(d.window_start);
  const end = Date.parse(d.window_end);
  const ticks = Array.from({ length: Math.round((end - start) / 10_800_000) + 1 }, (_, i) => start + i * 10_800_000);

  return (
    <Card
      testId="evolution-chart"
      title="Would a later forecast have helped?"
      sub="Average miss for the day next to each. Hover the chart for publish times."
    >
      <div className="legend" style={{ marginBottom: 8 }}>
        {lines.map((l) => (
          <span key={l.key}>
            <Swatch color={l.color} /> {l.label}
            {l.mae != null && <b style={{ color: "var(--ink)", fontWeight: 600 }}>{num(l.mae)} MW</b>}
          </span>
        ))}
        <span>
          <Swatch color="var(--series-actual)" /> Actual
        </span>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="t" type="number" domain={[start, end]} ticks={ticks} tickFormatter={fmtTime} stroke="var(--axis)" />
          <YAxis tickFormatter={axisGw} stroke="var(--axis)" width={64} />
          <Tooltip
            cursor={{ stroke: "var(--axis)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Record<string, number | undefined> & { t: number; time: string };
              const rows = [
                ...lines.filter((l) => p[l.key] != null).map((l) => ({ label: `${l.label.replace(" (too late)", "")} · ${fmtDayTime(l.publishTime)}`, value: mw(p[l.key]), color: l.color })),
                { label: "Actual", value: mw(p.actual), color: "var(--series-actual)" },
              ];
              return <TooltipBox title={`${fmtTime(p.t)} ${tzName(p.time)}`} rows={rows} />;
            }}
          />
          {lines.map((l) => (
            <Line key={l.key} dataKey={l.key} stroke={l.color} strokeWidth={l.width} dot={false} isAnimationActive={false} />
          ))}
          <Line dataKey="actual" stroke="var(--series-actual)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}

function HourlyTable({ d }: { d: DayView }) {
  const rows = d.series.filter((p) => p.forecast != null);
  return (
    <section className="card">
      <details>
        <summary>Hourly table ({rows.length} hours)</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Hour ({tzName(d.window_start)})</th>
                <th>Forecast MW</th>
                <th>Actual MW</th>
                <th>Forecast vs actual</th>
                <th>80% band MW</th>
                <th>Corrected MW</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.time}>
                  <td>{fmtTime(p.time)}</td>
                  <td>{num(p.forecast!)}</td>
                  <td>{num(p.actual)}</td>
                  <td style={{ color: p.forecast! - p.actual > 0 ? "var(--critical)" : "var(--div-under)" }}>{vsActual(p.forecast! - p.actual)}</td>
                  <td>
                    {num(p.band_low!)} – {num(p.band_high!)}
                  </td>
                  <td>{p.corrected != null ? num(p.corrected) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
