import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { BASKET_MAX, useBasket } from "./basket";
import { BasketButton, BasketDrawer, flyToBasket, itemTitle, UndoToast, type Removed } from "./components/Basket";
import { GuttersForm, guttersFields } from "./components/GuttersForm";
import { Logo } from "./components/Logo";
import { PricePanel } from "./components/PricePanel";
import { WindowsForm, WINDOWS_FIELDS } from "./components/WindowsForm";
import { firstName, useCustomer } from "./customer";
import { formatPence } from "./format";
import { useConfig, useMediaQuery, usePrefersReducedMotion, useQuote } from "./hooks";
import { usePipedrive } from "./pipedrive";
import {
  errorFor,
  guttersRequest,
  guttersState,
  initialGutters,
  initialWindows,
  unmatchedErrors,
  windowsRequest,
  windowsState,
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
  const reduced = usePrefersReducedMotion();

  const setW = useCallback((p: Partial<WindowsState>) => setWin((s) => ({ ...s, ...p })), []);
  const setG = useCallback((p: Partial<GuttersState>) => setGut((s) => ({ ...s, ...p })), []);

  const winReq = useMemo(() => windowsRequest(win), [win]);
  const gutReq = useMemo(() => guttersRequest(gut), [gut]);
  const winQ = useQuote(winReq);
  const gutQ = useQuote(gutReq);

  const isWin = tab === "windows";
  const q = isWin ? winQ : gutQ;
  const req = isWin ? winReq : gutReq;
  const override = isWin ? win.override : gut.override;
  const known = isWin ? WINDOWS_FIELDS : guttersFields(gut.extras.length);

  /* ----- Basket ----- */
  const basket = useBasket();
  const customer = useCustomer();
  const pipedrive = usePipedrive(config.pipedrive?.enabled === true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; tab: Tab } | null>(null);
  const [removed, setRemoved] = useState<Removed | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const basketBtnRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const announceTimer = useRef(0);

  const announce = useCallback((msg: string) => {
    // Clear first so a repeated message is announced again.
    setAnnouncement("");
    window.clearTimeout(announceTimer.current);
    announceTimer.current = window.setTimeout(() => setAnnouncement(msg), 40);
  }, []);

  const editIndex = editing ? basket.items.findIndex((i) => i.id === editing.id) : -1;
  // The item being edited was removed or cleared: stop editing.
  useEffect(() => {
    if (editing && editIndex === -1) setEditing(null);
  }, [editing, editIndex]);
  const editingHere = editing && editing.tab === tab && editIndex !== -1 ? editing : null;

  const resetTab = (t: Tab) => {
    if (t === "windows") setWin(initialWindows());
    else setGut(initialGutters(config.gutters.ask_about));
    setResets((n) => n + 1);
  };

  const reset = () => {
    resetTab(tab);
    if (editingHere) setEditing(null);
  };

  /** Add the current quote to the basket, or write it back over the item being edited. */
  const commit = (from: HTMLElement): boolean => {
    const quote = q.result;
    const request = q.resultFor;
    if (!quote || !request || request !== req) return false;
    if (editingHere) {
      basket.update(editingHere.id, request, quote);
      setEditing(null);
      announce(`Item ${editIndex + 1} updated: ${quote.title}, ${formatPence(quote.total)} ${basisWord(quote.basis)}.`);
    } else {
      if (basket.items.length >= BASKET_MAX) return false;
      basket.add(request, quote);
      flyToBasket(from, "Added", reduced);
      const n = basket.items.length + 1;
      announce(
        `Added to basket: ${quote.title}, ${formatPence(quote.total)} ${basisWord(quote.basis)}. ${n} ${
          n === 1 ? "item" : "items"
        } in the basket.`,
      );
    }
    resetTab(tab);
    return true;
  };

  const cancelEdit = () => {
    if (!editingHere) return;
    setEditing(null);
    resetTab(tab);
    announce("Edit cancelled. The basket item is unchanged.");
  };

  const openDrawer = () => {
    openerRef.current = (document.activeElement as HTMLElement | null) ?? basketBtnRef.current;
    setDrawerOpen(true);
  };

  const closeDrawer = useCallback((opts?: { returnFocus?: boolean }) => {
    setDrawerOpen(false);
    if (opts?.returnFocus === false) return;
    const back = openerRef.current?.isConnected ? openerRef.current : basketBtnRef.current;
    window.setTimeout(() => back?.focus(), 0);
  }, []);

  const editItem = (id: string) => {
    const index = basket.items.findIndex((i) => i.id === id);
    if (index === -1) return;
    const r = basket.items[index].request;
    const t: Tab = r.quote_type;
    if (r.quote_type === "windows") setWin(windowsState(r));
    else setGut(guttersState(r, config.gutters.ask_about));
    setTab(t);
    setResets((n) => n + 1);
    setEditing({ id, tab: t });
    closeDrawer({ returnFocus: false });
    announce(`Editing item ${index + 1} in the ${t === "windows" ? "Windows" : "Gutters & fascias"} tab.`);
    window.setTimeout(() => {
      bannerRef.current?.focus({ preventScroll: true });
      bannerRef.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    }, 80);
  };

  const removeItem = (id: string) => {
    const index = basket.items.findIndex((i) => i.id === id);
    if (index === -1) return;
    const p = basket.pricedItems[index];
    const title = itemTitle(p);
    basket.remove(id);
    setRemoved({ item: p.item, index, title });
    announce(`Removed item ${index + 1}, ${title}. Undo is available for 5 seconds.`);
    // Keep focus in the drawer: on the Edit button of the item that moved up, or the dialog itself.
    window.setTimeout(() => {
      const edits = document.querySelectorAll<HTMLElement>(".drawer .bitem__btn--edit");
      const next = edits[Math.min(index, edits.length - 1)];
      (next ?? document.querySelector<HTMLElement>(".drawer"))?.focus();
    }, 230);
  };

  const undoRemove = () => {
    if (!removed) return;
    basket.restore(removed.item, removed.index);
    announce(`Restored item ${removed.index + 1}, ${removed.title}.`);
    setRemoved(null);
    if (drawerOpen) window.setTimeout(() => document.querySelector<HTMLElement>(".drawer")?.focus(), 0);
  };

  const dismissToast = useCallback(() => setRemoved(null), []);

  // Nothing left to send: forget the last send, so a new customer never shows "Already sent".
  const resetPipedrive = pipedrive.reset;
  const nothingToSend = basket.items.length === 0 && customer.isEmpty;
  useEffect(() => {
    if (nothingToSend) resetPipedrive();
  }, [nothingToSend, resetPipedrive]);

  const clearBasket = () => {
    const n = basket.items.length;
    const hadCustomer = !customer.isEmpty;
    basket.clear();
    customer.clear();
    pipedrive.reset();
    setRemoved(null);
    if (n === 0) announce("Customer details cleared.");
    else if (hadCustomer) announce(`Basket and customer details cleared. ${n} ${n === 1 ? "item" : "items"} removed.`);
    else announce(`Basket cleared. ${n} ${n === 1 ? "item" : "items"} removed.`);
  };

  const clearCustomer = () => {
    customer.clear();
    announce("Customer details cleared.");
  };

  /** After sending to Pipedrive: the same clear as "Clear basket", without the confirm step. */
  const startNextCustomer = () => {
    clearBasket();
    announce("Ready for the next customer. The basket and customer details are cleared.");
  };

  return (
    <>
      <Header
        tab={tab}
        onTab={setTab}
        onReset={reset}
        basket={
          <BasketButton
            ref={basketBtnRef}
            count={basket.items.length}
            open={drawerOpen}
            onOpen={openDrawer}
            customer={firstName(customer.customer.name)}
          />
        }
      />
      <main className="layout">
        <div
          className="layout__form"
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
          key={`${tab}-${resets}`}
        >
          {editingHere && (
            <div className="edit-banner" ref={bannerRef} tabIndex={-1}>
              <span className="edit-banner__n" aria-hidden="true">
                {editIndex + 1}
              </span>
              <p className="edit-banner__text">
                <b>Editing item {editIndex + 1}</b>
                <span>Change the details, then press Update item.</span>
              </p>
              <button type="button" className="edit-banner__cancel" onClick={cancelEdit}>
                Cancel edit
              </button>
            </div>
          )}
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
            current={q.resultFor === req}
            basket={{
              mode: editingHere ? "update" : "add",
              itemNumber: editingHere ? editIndex + 1 : null,
              count: basket.items.length,
              full: basket.items.length >= BASKET_MAX,
              onCommit: commit,
              onCancel: cancelEdit,
              onOpen: openDrawer,
            }}
          />
        </div>
      </main>
      <Footer config={config} />
      <BasketDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        items={basket.pricedItems}
        groups={basket.groups}
        summary={basket.summary}
        stale={basket.stale}
        loading={basket.loading}
        failed={basket.failed}
        hasPriced={basket.hasPriced}
        onRetry={basket.retry}
        editingId={editing?.id ?? null}
        onEdit={editItem}
        onRemove={removeItem}
        onClear={clearBasket}
        customer={customer}
        onClearCustomer={clearCustomer}
        toast={<UndoToast removed={removed} onUndo={undoRemove} onDone={dismissToast} />}
        pipedrive={pipedrive.enabled ? { store: pipedrive, onStartNext: startNextCustomer } : null}
      />
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </>
  );
}

const basisWord = (b: "per_visit" | "one_off") => (b === "per_visit" ? "per visit" : "one-off");

function Header({
  tab,
  onTab,
  onReset,
  basket,
  disabled = false,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  onReset: () => void;
  basket?: ReactNode;
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
          {basket && <div className="masthead__basket">{basket}</div>}
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
