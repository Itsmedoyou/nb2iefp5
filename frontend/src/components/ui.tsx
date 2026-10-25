import { ReactNode, useEffect, useRef, useState } from "react";

/** Fetch with stale-while-loading: keeps the previous data visible during a refetch. */
export function useFetch<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    setLoading(true);
    fn()
      .then((d) => id === seq.current && (setData(d), setError(null)))
      .catch((e: Error) => id === seq.current && setError(e.message))
      .finally(() => id === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading };
}

export function Card({ title, sub, actions, children, testId }: { title: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="card" data-testid={testId}>
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {sub && <p className="sub">{sub}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Tile({ label, value, unit, badge, hint, testId, wide }: { label: string; value: ReactNode; unit?: string; badge?: ReactNode; hint?: ReactNode; testId?: string; wide?: boolean }) {
  return (
    <div className={`tile${wide ? " wide" : ""}`} data-testid={testId}>
      <div className="label">{label}</div>
      <div className="value-row">
        <div className="value">
          {value}
          {unit && <small>{unit}</small>}
        </div>
        {badge && <span className="badge">{badge}</span>}
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Swatch({ color, box }: { color: string; box?: boolean }) {
  return <i className={`swatch${box ? " box" : ""}`} style={{ background: color }} aria-hidden />;
}

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

export function TooltipBox({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="tooltip">
      <div className="t">{title}</div>
      {rows.map((r) => (
        <div className="row" key={r.label}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {r.color && <Swatch color={r.color} />}
            {r.label}
          </span>
          <b>{r.value}</b>
        </div>
      ))}
    </div>
  );
}

/** The one colour key used across the app: red = forecast above actual, blue = below. */
export function ColourKey() {
  return (
    <div className="colour-key" data-testid="colour-key">
      <span>
        <Swatch color="var(--div-over)" box />
        <span>
          <b>Forecast higher than actual</b>: less wind came than expected, so you bought too little
        </span>
      </span>
      <span>
        <Swatch color="var(--div-under)" box />
        <span>
          <b>Forecast lower than actual</b>: more wind came than expected, so you bought more than needed
        </span>
      </span>
    </div>
  );
}
