import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { GuttersForm, guttersFields } from "./components/GuttersForm";
import { Logo } from "./components/Logo";
import { PricePanel } from "./components/PricePanel";
import { WindowsForm, WINDOWS_FIELDS } from "./components/WindowsForm";
import { useConfig, useMediaQuery, useQuote } from "./hooks";
import {
  errorFor,
  guttersRequest,
  initialGutters,
  initialWindows,
  unmatchedErrors,
  windowsRequest,
  type GuttersState,
  type WindowsState,
} from "./state";
import type { Config } from "./types";

type Tab = "windows" | "gutters";
const TABS: { id: Tab; label: string }[] = [
  { id: "windows", label: "Windows" },
  { id: "gutters", label: "Gutters & fascias" },
];

export default function App() {
  const { state: cfg, retry } = useConfig();
  const config = cfg.status === "ready" ? cfg.config : null;

  return (
    <div className="app">
      {config ? (
        <Calculator config={config} />
      ) : (
        <>
          <Header tab="windows" onTab={() => {}} onReset={() => {}} disabled />
          <main className="layout" aria-busy={cfg.status === "loading"}>
            {cfg.status === "error" ? <ConfigError onRetry={retry} /> : <Skeleton />}
          </main>
          <Footer config={null} />
        </>
      )}
    </div>
  );
}

function Calculator({ config }: { config: Config }) {
  const [tab, setTab] = useState<Tab>("windows");
  const [resets, setResets] = useState(0);
  const [win, setWin] = useState<WindowsState>(initialWindows);
  const [gut, setGut] = useState<GuttersState>(() => initialGutters(config.gutters.ask_about));
  const compact = useMediaQuery("(max-width: 899px)");

  const setW = useCallback((p: Partial<WindowsState>) => setWin((s) => ({ ...s, ...p })), []);
  const setG = useCallback((p: Partial<GuttersState>) => setGut((s) => ({ ...s, ...p })), []);

  const winReq = useMemo(() => windowsRequest(win), [win]);
  const gutReq = useMemo(() => guttersRequest(gut), [gut]);
  const winQ = useQuote(winReq);
  const gutQ = useQuote(gutReq);

  const isWin = tab === "windows";
  const q = isWin ? winQ : gutQ;
  const override = isWin ? win.override : gut.override;
  const known = isWin ? WINDOWS_FIELDS : guttersFields(gut.extras.length);

  const reset = () => {
    if (isWin) setWin(initialWindows());
    else setGut(initialGutters(config.gutters.ask_about));
    setResets((n) => n + 1);
  };

  return (
    <>
      <Header tab={tab} onTab={setTab} onReset={reset} />
      <main className="layout">
        <div
          className="layout__form"
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
          key={`${tab}-${resets}`}
        >
          {isWin ? (
            <WindowsForm config={config} state={win} set={setW} errors={winQ.errors} />
          ) : (
            <GuttersForm config={config} state={gut} set={setG} errors={gutQ.errors} />
          )}
        </div>
        <div className="layout__panel">
          <PricePanel
            key={tab}
            title={isWin ? "Window cleaning" : "Gutters & fascias"}
            result={q.result}
            errors={q.errors}
            looseErrors={unmatchedErrors(q.errors, known)}
            loading={q.loading}
            unreachable={q.unreachable}
            onRetry={q.retry}
            onFrequency={isWin ? (f) => setW({ frequency: f }) : undefined}
            override={override}
            onOverride={(o) => (isWin ? setW({ override: o }) : setG({ override: o }))}
            overrideErrors={{
              total: errorFor(q.errors, "override.total"),
              reason: errorFor(q.errors, "override.reason"),
            }}
            compact={compact}
          />
        </div>
      </main>
      <Footer config={config} />
    </>
  );
}

function Header({
  tab,
  onTab,
  onReset,
  disabled = false,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  onReset: () => void;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const n = (i + 1) % TABS.length;
    onTab(TABS[n].id);
    refs.current[n]?.focus();
  };
  return (
    <header className="masthead">
      <AbacusBeads />
      <div className="masthead__inner">
        <div className="masthead__brand">
          <Logo variant="light" />
          <span className="masthead__tool">Price calculator</span>
        </div>
        <div className="masthead__bar">
          <div role="tablist" aria-label="Quote type" className="tabs">
            {TABS.map((t, i) => (
              <button
                key={t.id}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                id={`tab-${t.id}`}
                role="tab"
                type="button"
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                className="tab"
                disabled={disabled}
                onClick={() => onTab(t.id)}
                onKeyDown={(e) => onKey(e, i)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {!disabled && (
            <button type="button" className="reset" onClick={onReset}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2.8 6.2A5.5 5.5 0 1 1 2.5 9.5" />
                <path d="M2.5 2.8v3.6h3.6" />
              </svg>
              Reset {tab === "windows" ? "windows" : "gutters"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

/** Decorative abacus: three rods with beads pushed to either side. */
const RODS: { y: number; left: number; right: number }[] = [
  { y: 30, left: 2, right: 4 },
  { y: 70, left: 4, right: 2 },
  { y: 110, left: 1, right: 5 },
];

function AbacusBeads() {
  const r = 13;
  const step = 28;
  return (
    <svg className="masthead__beads" viewBox="0 0 560 140" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
      {RODS.map((rod, i) => (
        <g key={i}>
          <line x1="0" x2="560" y1={rod.y} y2={rod.y} />
          {Array.from({ length: rod.left }, (_, j) => (
            <circle key={`l${j}`} cx={150 + j * step} cy={rod.y} r={r} />
          ))}
          {Array.from({ length: rod.right }, (_, j) => (
            <circle
              key={`r${j}`}
              cx={540 - j * step}
              cy={rod.y}
              r={r}
              className={i === 1 && j === rod.right - 1 ? "is-amber" : undefined}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}

function Footer({ config }: { config: Config | null }) {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <Logo size="sm" />
        <p className="footer__meta">
          {config ? <>Price list: {config.price_list_date} · Prices include VAT</> : "Prices include VAT"}
        </p>
        {config && (
          <ul className="footer__phones">
            <li>
              <span>Office</span> <a href={`tel:${config.contact.phone.replace(/\s/g, "")}`}>{config.contact.phone}</a>
            </li>
            <li>
              <span>Mobile</span>{" "}
              <a href={`tel:${config.contact.mobile.replace(/\s/g, "")}`}>{config.contact.mobile}</a>
            </li>
            <li>
              <span>Sales</span>{" "}
              <a href={`tel:${config.contact.sales_mobile.replace(/\s/g, "")}`}>{config.contact.sales_mobile}</a>
            </li>
          </ul>
        )}
      </div>
    </footer>
  );
}

function Skeleton() {
  return (
    <>
      <div className="layout__form" aria-hidden="true">
        <div className="form">
          {[6, 5, 3, 1].map((n, i) => (
            <div className="section skel-section" key={i}>
              <div className="section__head">
                <span className="skel skel--title" />
              </div>
              <div className="skel-row">
                {Array.from({ length: n }, (_, j) => (
                  <span className="skel skel--seg" key={j} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="layout__panel" aria-hidden="true">
        <div className="panel panel--skeleton">
          <div className="panel__body">
            <span className="skel skel--on-blue skel--small" />
            <span className="skel skel--on-blue skel--total" />
            <span className="skel skel--on-blue skel--line" />
            <span className="skel skel--on-blue skel--line" />
            <span className="skel skel--on-blue skel--line skel--short" />
          </div>
        </div>
      </div>
      <p className="sr-only" role="status">
        Loading the price list
      </p>
    </>
  );
}

function ConfigError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="config-error" role="alert">
      <h1 className="config-error__title">The price list didn't load</h1>
      <p>The calculator couldn't reach the price service. Check the connection, then try again.</p>
      <button type="button" className="btn btn--primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
