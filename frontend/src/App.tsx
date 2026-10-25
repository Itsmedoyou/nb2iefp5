import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useFetch } from "./components/ui";
import AccuracyView from "./pages/AccuracyView";
import DecisionView from "./pages/DecisionView";

type Tab = "decision" | "accuracy";
const TABS: { id: Tab; label: string }[] = [
  { id: "decision", label: "Decision replay" },
  { id: "accuracy", label: "Forecast accuracy" },
];

/** App state lives in the URL hash (#tab?date=…) so every view is shareable. */
function readHash() {
  const [tab, query = ""] = window.location.hash.replace(/^#\/?/, "").split("?");
  const p = new URLSearchParams(query);
  return {
    tab: (TABS.some((t) => t.id === tab) ? tab : "decision") as Tab,
    date: p.get("date") ?? "",
  };
}

export default function App() {
  const [state, setState] = useState(readHash);
  const meta = useFetch(() => api.meta(), []);
  // Light by default; dark only when the user chooses it (remembered per browser).
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      return localStorage.getItem("theme") === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });

  useEffect(() => {
    const onHash = () => setState(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  const update = useCallback((patch: Partial<ReturnType<typeof readHash>>) => {
    setState((s) => {
      const next = { ...s, ...patch };
      window.history.replaceState(null, "", `#${next.tab}${next.date ? `?date=${next.date}` : ""}`);
      return next;
    });
  }, []);

  const dates = meta.data?.delivery_dates ?? [];
  const date = dates.includes(state.date) ? state.date : (dates[13] ?? "");
  const isDark = theme === "dark";

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <img src="/favicon.svg" width={30} height={30} alt="" />
            <div>
              Wind Forecast Desk
              <small>GB day-ahead · national wind · pilot, January 2026</small>
            </div>
          </div>
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} className="tab" role="tab" aria-selected={state.tab === t.id} onClick={() => update({ tab: t.id })}>
                {t.label}
              </button>
            ))}
          </nav>
          <button className="icon-btn" aria-label="Toggle dark mode" onClick={() => setTheme(isDark ? "light" : "dark")}>
            {isDark ? "☀" : "☾"}
          </button>
        </div>
      </header>
      <main>
        {meta.error && <p className="error">Could not reach the API: {meta.error}</p>}
        {meta.data && state.tab === "decision" && (
          <DecisionView dates={dates} date={date} onDate={(d) => update({ date: d })} />
        )}
        {meta.data && state.tab === "accuracy" && (
          <AccuracyView onOpenDay={(d) => update({ tab: "decision", date: d })} />
        )}
      </main>
    </>
  );
}
