import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Accuracy, api } from "../api";
import { Card, ColourKey, Swatch, Tile, TooltipBox, useFetch } from "../components/ui";
import { axisGw, fmtDateShort, num, pct, vsActual } from "../format";

const OVER = "var(--div-over)";
const UNDER = "var(--div-under)";
const signColor = (v: number) => (v > 0 ? OVER : UNDER);
/** Round 0.5 GW / 1 GW axis steps covering the data range and zero. */
const niceTicks = (values: number[]) => {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const step = hi - lo > 4000 ? 1000 : 500;
  const first = Math.floor(lo / step);
  return Array.from({ length: Math.ceil(hi / step) - first + 1 }, (_, i) => (first + i) * step);
};
const kmw = (v: number) => (v / 1000).toLocaleString("en-GB", { maximumFractionDigits: 2 });

export default function AccuracyView({ onOpenDay }: { onOpenDay: (d: string) => void }) {
  const { data, error, loading } = useFetch(() => api.accuracy(), []);
  return (
    <>
      <div className="page-head">
        <h1>Forecast accuracy</h1>
        <p>
          How far could the desk trust the wind forecast it had at decision time? Measured over every hour delivered from 2 January to 1
          February 2026 (31 purchase decisions × 24 hours).
        </p>
      </div>
      {error && <p className="error">Could not load accuracy: {error}</p>}
      {data && (
        <div className={loading ? "loading" : undefined} style={{ display: "grid", gap: 20 }}>
          <Headline a={data} />
          <ColourKey />
          <SummaryTiles a={data} />
          <DailyChart a={data} onOpenDay={onOpenDay} />
          <div className="grid-2">
            <HorizonChart a={data} />
            <LevelChart a={data} />
          </div>
          <HistogramChart a={data} />
          <RegressionCard a={data} />
        </div>
      )}
    </>
  );
}

function Headline({ a }: { a: Accuracy }) {
  const s = a.summary;
  const p10 = s.surprise_quantiles["10"];
  return (
    <div className="callout" data-testid="headline">
      <div className="big">
        Plan for {num(Math.abs(p10))} MW <u>less</u> wind than forecast to be covered in 9 hours out of 10.
      </div>
      <p>Based on the latest forecast before the 09:20 order deadline, across all {s.n} hours delivered in January.</p>
    </div>
  );
}

function SummaryTiles({ a }: { a: Accuracy }) {
  const s = a.summary;
  return (
    <div className="tiles">
      <Tile
        label="Average miss"
        value={num(s.mae)}
        unit="MW"
        hint={`${pct(s.nmae)} of average wind output`}
        testId="kpi-mae"
      />
      <Tile
        label="On average, the forecast was"
        value={num(Math.abs(s.bias))}
        unit="MW"
        hint={<span className={`pill ${s.bias > 0 ? "over" : "under"}`}>{s.bias > 0 ? "▲ higher than actual" : "▼ lower than actual"}</span>}
        testId="kpi-bias"
      />
      <Tile label="Miss in 9 of 10 hours under" value={num(s.abs_error_p90)} unit="MW" testId="kpi-p90" />
      <Tile label="Hours forecast was higher" value={pct(s.over_forecast_share)} hint="than the actual wind" />
    </div>
  );
}

function DailyChart({ a, onOpenDay }: { a: Accuracy; onOpenDay: (d: string) => void }) {
  return (
    <Card
      testId="daily-chart"
      title="How far off was each day's forecast?"
      sub="Average gap between forecast and actual wind for each delivery day. Bars above zero: forecast higher than actual. Click a bar to replay that day."
      actions={
        <div className="legend">
          <span>
            <Swatch color={OVER} box /> Forecast higher than actual
          </span>
          <span>
            <Swatch color={UNDER} box /> Forecast lower than actual
          </span>
        </div>
      }
    >
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={a.daily} margin={{ top: 8, right: 12, bottom: 4, left: 4 }} barCategoryGap={2}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="delivery_date" tickFormatter={(d: string) => String(Number(d.slice(8)))} stroke="var(--axis)" interval={0} fontSize={11} />
          <YAxis tickFormatter={axisGw} stroke="var(--axis)" width={64} />
          <ReferenceLine y={0} stroke="var(--axis)" />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0].payload as Accuracy["daily"][number];
              return (
                <TooltipBox
                  title={fmtDateShort(r.delivery_date)}
                  rows={[
                    { label: "On average", value: vsActual(r.bias), color: signColor(r.bias) },
                    { label: "Average miss", value: `${num(r.mae)} MW` },
                    { label: "Forecast energy", value: `${num(r.forecast_mwh / 1000)} GWh` },
                    { label: "Actual energy", value: `${num(r.actual_mwh / 1000)} GWh` },
                  ]}
                />
              );
            }}
          />
          <Bar dataKey="bias" radius={[4, 4, 4, 4]} cursor="pointer" onClick={(r: { delivery_date: string }) => onOpenDay(r.delivery_date)} isAnimationActive={false}>
            {a.daily.map((r) => (
              <Cell key={r.delivery_date} fill={signColor(r.bias)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

function HorizonChart({ a }: { a: Accuracy }) {
  const data = a.by_horizon.map((r) => ({ ...r, label: `${r.from_h}–${r.to_h}h` }));
  return (
    <Card
      testId="horizon-chart"
      title="The further ahead the forecast, the bigger the miss"
      sub="Average miss by how many hours ahead the forecast was made. Shaded: the range that applies to your 09:20 orders."
      actions={
        <div className="legend">
          <span>
            <Swatch color="var(--series-miss)" /> Average miss
          </span>
          <span>
            <Swatch color={OVER} /> Average amount forecast was higher than actual
          </span>
        </div>
      }
    >
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <ReferenceArea x1="12–18h" x2="36–42h" fill="var(--surface-2)" fillOpacity={0.9} />
          <XAxis dataKey="label" stroke="var(--axis)" fontSize={10} interval={0} />
          <YAxis tickFormatter={axisGw} stroke="var(--axis)" width={64} domain={[0, "auto"]} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0].payload as (typeof data)[number];
              return (
                <TooltipBox
                  title={`Published ${r.label} ahead`}
                  rows={[
                    { label: "Average miss", value: `${num(r.mae)} MW`, color: "var(--series-miss)" },
                    { label: "On average", value: vsActual(r.bias), color: OVER },
                    { label: "9 in 10 misses under", value: `${num(r.abs_error_p90)} MW` },
                    { label: "Hours compared", value: num(r.n) },
                  ]}
                />
              );
            }}
          />
          <Line dataKey="mae" stroke="var(--series-miss)" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
          <Line dataKey="bias" stroke={OVER} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}

function LevelChart({ a }: { a: Accuracy }) {
  const data = a.by_level.map((r) => ({ ...r, label: `${r.from_mw / 1000}–${r.to_mw / 1000} GW` }));
  return (
    <Card
      testId="level-chart"
      title="The more wind forecast, the more it overshoots"
      sub="How much higher than actual the forecast was on average, grouped by how much wind was forecast. Windy forecasts carry the biggest risk of buying too little."
    >
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 22, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="label" stroke="var(--axis)" fontSize={11} />
          <YAxis tickFormatter={axisGw} stroke="var(--axis)" width={60} ticks={niceTicks(data.map((r) => r.bias))} />
          <ReferenceLine y={0} stroke="var(--axis)" />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0].payload as (typeof data)[number];
              return (
                <TooltipBox
                  title={`Forecast ${r.label}`}
                  rows={[
                    { label: "On average", value: vsActual(r.bias), color: signColor(r.bias) },
                    { label: "Average miss", value: `${num(r.mae)} MW` },
                    { label: "Hours", value: num(r.n) },
                  ]}
                />
              );
            }}
          />
          <Bar dataKey="bias" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((r) => (
              <Cell key={r.label} fill={signColor(r.bias)} />
            ))}
            <LabelList dataKey="n" position="top" formatter={(n: number) => `${n} h`} fill="var(--ink-muted)" fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

function HistogramChart({ a }: { a: Accuracy }) {
  const data = a.histogram.map((b) => ({ ...b, mid: (b.from_mw + b.to_mw) / 2, label: `${kmw(b.from_mw)}…${kmw(b.to_mw)}` }));
  return (
    <Card testId="histogram-chart" title="How big were the hourly misses?" sub="Number of hours by size of miss, in 1 GW steps. Right of zero: forecast higher than actual. Most hours sit on the right.">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 22, left: 4 }} barCategoryGap={2}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="mid"
            tickFormatter={axisGw}
            stroke="var(--axis)"
            fontSize={11}
            label={{ value: "← forecast lower than actual  ·  forecast higher than actual →", position: "insideBottom", offset: -16, fill: "var(--ink-muted)", fontSize: 12 }}
          />
          <YAxis stroke="var(--axis)" width={64} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0].payload as (typeof data)[number];
              return (
                <TooltipBox
                  title={r.mid > 0 ? `Forecast ${num(r.from_mw)}–${num(r.to_mw)} MW higher than actual` : `Forecast ${num(-r.to_mw)}–${num(-r.from_mw)} MW lower than actual`}
                  rows={[{ label: "Hours", value: num(r.count) }]}
                />
              );
            }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((r) => (
              <Cell key={r.mid} fill={signColor(r.mid)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

function RegressionCard({ a }: { a: Accuracy }) {
  const r = a.regression;
  const wf = r.walk_forward;
  const bars = [
    { label: "Forecast as published", mae: wf.mae_raw },
    { label: "Adjusted for the pattern", mae: wf.mae_regression_corrected },
  ];
  const gain = 1 - wf.mae_regression_corrected / wf.mae_raw;
  return (
    <Card testId="regression-card" title="Can the forecast be corrected?">
      <div className="grid-2">
        <p style={{ margin: 0 }}>
          The more wind is forecast, the more it overshoots: roughly <b>{num(r.coefficients.per_GW_forecast)} MW extra for every 1 GW</b> forecast. Adjusting
          for this pattern, learned only from days already delivered, cut the average miss by <b>{pct(gain)}</b>.
        </p>
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 70, bottom: 4, left: 8 }}>
            <XAxis type="number" hide domain={[0, "dataMax"]} />
            <YAxis type="category" dataKey="label" width={170} stroke="var(--axis)" tickLine={false} fontSize={12} />
            <Bar dataKey="mae" radius={[0, 4, 4, 0]} barSize={22} isAnimationActive={false}>
              {bars.map((b, i) => (
                <Cell key={b.label} fill={i === 0 ? "var(--run-earlier)" : "var(--series-corrected)"} />
              ))}
              <LabelList dataKey="mae" position="right" formatter={(v: number) => `${num(v)}\u00a0MW`} fill="var(--ink)" fontSize={12} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
