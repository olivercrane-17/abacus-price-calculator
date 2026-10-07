import { AnimatePresence, motion } from "framer-motion";
import { forwardRef, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { BasketGroup, QuoteRequest } from "../types";
import type { PricedItem } from "../basket";
import { formatPence } from "../format";
import { usePrefersReducedMotion } from "../hooks";
import { basketRecord, type CustomerStore } from "../customer";
import { customerErrorField, sendCheck, sendFingerprint, type CustomerField, type PipedriveStore } from "../pipedrive";
import { CustomerDetails, type CustomerErrors } from "./CustomerDetails";
import { PipedriveSend } from "./PipedriveSend";
import { CopyButton } from "./PricePanel";

/* ---------- Helpers ---------- */

/** A readable name for an item the API couldn't price (it has no quote.title). */
export function fallbackTitle(r: QuoteRequest): string {
  const kind = r.quote_type === "windows" ? "windows" : "gutters";
  if (r.property.kind === "other") return `${r.property.description || "Other property"} (${kind})`;
  return `${r.property.bedrooms} bed ${kind}`;
}

export function itemTitle(p: PricedItem): string {
  return p.result?.quote?.title ?? p.item.provisional?.title ?? fallbackTitle(p.item.request);
}

/* ---------- The "Added" chip that flies into the basket ---------- */

let landingAt = 0;

/** When the current flight lands (ms since page load), so the badge can count up on arrival. */
export function pendingLanding(): number {
  return Math.max(0, landingAt - performance.now());
}

function visibleTarget(): HTMLElement | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>("[data-basket-target]"));
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth) {
      return el;
    }
  }
  return null;
}

export function flyToBasket(from: HTMLElement, text: string, reduced: boolean) {
  if (reduced || typeof from.animate !== "function") return;
  const target = visibleTarget();
  const a = from.getBoundingClientRect();
  const b = target?.getBoundingClientRect();
  const x0 = a.left + a.width / 2;
  const y0 = a.top + a.height / 2;
  const x1 = b ? b.left + b.width / 2 : window.innerWidth - 40;
  const y1 = b ? b.top + b.height / 2 : -20;

  const chip = document.createElement("div");
  chip.className = "fly-chip";
  chip.setAttribute("aria-hidden", "true");
  chip.innerHTML = '<svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3L13 4.5"/></svg><span></span>';
  chip.querySelector("span")!.textContent = text;
  document.body.appendChild(chip);
  const w = chip.offsetWidth;
  const h = chip.offsetHeight;
  const at = (x: number, y: number, s: number) => `translate(${x - w / 2}px, ${y - h / 2}px) scale(${s})`;
  const peak = Math.min(y0, y1) - 70;
  const duration = 720;
  landingAt = performance.now() + duration;
  const anim = chip.animate(
    [
      { transform: at(x0, y0, 0.6), opacity: 0 },
      { transform: at(x0, y0 - 18, 1.05), opacity: 1, offset: 0.18 },
      { transform: at((x0 + x1) / 2, peak, 0.9), opacity: 1, offset: 0.55 },
      { transform: at(x1, y1, 0.35), opacity: 0.2 },
    ],
    { duration, easing: "cubic-bezier(0.45, 0, 0.3, 1)", fill: "forwards" },
  );
  const done = () => chip.remove();
  anim.onfinish = done;
  anim.oncancel = done;
}

/* ---------- Header button ---------- */

/** Shows the count, catching up when a flying chip lands, with a small pop on change. */
function useLandedCount(count: number): [number, number] {
  const [shown, setShown] = useState(count);
  const [bumps, setBumps] = useState(0);
  useEffect(() => {
    if (count === shown) return;
    const wait = count > shown ? pendingLanding() : 0;
    const t = window.setTimeout(() => {
      setShown(count);
      setBumps((n) => n + 1);
    }, wait);
    return () => window.clearTimeout(t);
  }, [count, shown]);
  return [shown, bumps];
}

export const BasketButton = forwardRef<
  HTMLButtonElement,
  { count: number; open: boolean; onOpen: () => void; customer?: string }
>(function BasketButton({ count, open, onOpen, customer = "" }, ref) {
  const [shown, bumps] = useLandedCount(count);
  return (
    <button
      ref={ref}
      type="button"
      className={`basket-btn ${shown > 0 ? "has-items" : ""}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Basket, ${count} ${count === 1 ? "item" : "items"}${customer ? `, customer ${customer}` : ""}`}
      data-basket-target="header"
      onClick={onOpen}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" className="basket-btn__icon">
        <path d="M3 7.5h14l-1.4 8.2a1.6 1.6 0 0 1-1.6 1.3H6a1.6 1.6 0 0 1-1.6-1.3Z" />
        <path d="M7 7.5 9 3M13 7.5 11 3" />
      </svg>
      <span className="basket-btn__label">Basket</span>
      {customer && (
        <span className="basket-btn__who" aria-hidden="true" title={customer}>
          {customer}
        </span>
      )}
      <span className="basket-btn__count" key={bumps} data-bump={bumps > 0 ? "" : undefined} aria-hidden="true">
        {shown}
      </span>
    </button>
  );
});

/* ---------- Drawer ---------- */

export interface Removed {
  item: PricedItem["item"];
  index: number;
  title: string;
}

interface DrawerProps {
  open: boolean;
  onClose: (opts?: { returnFocus?: boolean }) => void;
  items: PricedItem[];
  groups: BasketGroup[];
  summary: string;
  stale: boolean;
  loading: boolean;
  failed: boolean;
  hasPriced: boolean;
  onRetry: () => void;
  editingId: string | null;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  customer: CustomerStore;
  onClearCustomer: () => void;
  toast: ReactNode;
  /** Send to Pipedrive, or null when it isn't set up (nothing about it is shown). */
  pipedrive: { store: PipedriveStore; onStartNext: () => void } | null;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

export function BasketDrawer(props: DrawerProps) {
  const { open, onClose, items } = props;
  const reduced = usePrefersReducedMotion();
  const layerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [confirmClear, setConfirmClear] = useState(false);
  const clearRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  // Starts collapsed; remembers whether staff opened it while the page is open.
  const [custOpen, setCustOpen] = useState(false);
  const hasCustomer = !props.customer.isEmpty;
  const record = basketRecord(
    props.customer.customer,
    props.summary && !props.stale ? props.summary : null,
    items.length > 0,
  );

  /* Send to Pipedrive */
  const pd = props.pipedrive;
  const cust = props.customer.customer;
  const requests = useMemo(() => items.map((p) => p.item.request), [items]);
  const pdOn = !!pd;
  const fingerprint = useMemo(() => (pdOn ? sendFingerprint(requests, cust) : ""), [pdOn, requests, cust]);
  const check = sendCheck({ items, stale: props.stale, failed: props.failed }, cust);
  const pdState = pd?.store.state;
  const pdSending = pdState?.status === "sending";
  const sentHere = !!pd && !pdSending && pd.store.sent?.fingerprint === fingerprint;
  // Server checks on the customer (422), shown on the fields until the details change.
  const custErrors: CustomerErrors = {};
  if (pdState?.status === "invalid" && pdState.fingerprint === fingerprint) {
    for (const e of pdState.errors) {
      const f = customerErrorField(e.field);
      if (f && !custErrors[f]) custErrors[f] = e.message;
    }
  }
  /** Open Customer details and put the cursor in the field that's missing. */
  const addDetails = (field: CustomerField) => {
    setCustOpen(true);
    window.setTimeout(() => {
      const input = layerRef.current?.querySelector<HTMLInputElement>(`.cust__f-${field} input`);
      input?.focus({ preventScroll: true });
      input?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    }, 60);
  };

  useEffect(() => {
    if (!open) setConfirmClear(false);
  }, [open]);
  useEffect(() => {
    if (items.length === 0 && !hasCustomer) setConfirmClear(false);
  }, [items.length, hasCustomer]);
  // No clearing while a send is on its way to Pipedrive.
  useEffect(() => {
    if (pdSending) setConfirmClear(false);
  }, [pdSending]);

  // Escape closes; Tab stays inside the drawer (and its undo toast).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !layerRef.current) return;
      const nodes = Array.from(layerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && layerRef.current.contains(active);
      if (e.shiftKey && (active === first || !inside || active === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Focus the dialog on open and stop the page behind from scrolling.
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const body = document.body.style;
    const prev = { overflow: body.overflow, paddingRight: body.paddingRight };
    // Make room for the scrollbar that's about to disappear, so the page doesn't jump sideways.
    const bar = window.innerWidth - document.documentElement.clientWidth;
    body.overflow = "hidden";
    if (bar > 0) body.paddingRight = `${bar}px`;
    return () => {
      body.overflow = prev.overflow;
      body.paddingRight = prev.paddingRight;
    };
  }, [open]);

  const priced = items.filter((p) => p.result?.ok).length;
  const attention = items.filter((p) => p.result && !p.result.ok).length;

  return (
    <div className="basket-layer" ref={layerRef}>
      <AnimatePresence>
        {open && (
          <motion.div
            key="scrim"
            className="drawer-scrim"
            aria-hidden="true"
            onClick={() => onClose()}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.22 }}
          />
        )}
        {open && (
          <motion.div
            key="drawer"
            ref={dialogRef}
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={reduced ? { opacity: 0 } : { x: "100%" }}
            animate={reduced ? { opacity: 1 } : { x: 0 }}
            exit={reduced ? { opacity: 0 } : { x: "100%" }}
            transition={reduced ? { duration: 0 } : { type: "tween", duration: 0.32, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <header className="drawer__head">
              <div className="drawer__heading">
                <h2 className="drawer__title" id={titleId}>
                  Basket
                </h2>
                <p className="drawer__meta">
                  {items.length === 0
                    ? hasCustomer
                      ? "No jobs yet, customer details added"
                      : "No jobs yet"
                    : `${items.length} ${items.length === 1 ? "job" : "jobs"}${
                        attention ? `, ${attention} ${attention === 1 ? "needs" : "need"} attention` : ""
                      }`}
                </p>
              </div>
              <span className={`drawer__status ${props.loading ? "is-on" : ""}`} aria-hidden="true">
                <span className="pulse" />
                Updating
              </span>
              <button type="button" className="drawer__close" aria-label="Close basket" onClick={() => onClose()}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </header>

            {props.failed && items.length > 0 && (
              <div className="drawer__offline" role="alert">
                <p>
                  <strong>Can't reach the price service.</strong>{" "}
                  {props.hasPriced ? "Showing the last prices worked out." : "These jobs haven't been priced yet."}
                </p>
                <button
                  type="button"
                  className="btn btn--primary btn--small"
                  onClick={() => {
                    props.onRetry();
                    dialogRef.current?.focus();
                  }}
                >
                  Try again
                </button>
              </div>
            )}

            <div className="drawer__body">
              <CustomerDetails
                store={props.customer}
                open={custOpen}
                onToggle={setCustOpen}
                onClear={props.onClearCustomer}
                errors={pd ? custErrors : undefined}
                sendsToPipedrive={!!pd}
              />
              {items.length === 0 ? (
                <EmptyBasket onStart={() => onClose()} />
              ) : (
                <ol className="bitems">
                  <AnimatePresence initial={false}>
                    {items.map((p, i) => (
                      <BasketRow
                        key={p.item.id}
                        p={p}
                        n={i + 1}
                        editing={p.item.id === props.editingId}
                        reduced={reduced}
                        onEdit={() => props.onEdit(p.item.id)}
                        onRemove={() => props.onRemove(p.item.id)}
                      />
                    ))}
                  </AnimatePresence>
                </ol>
              )}
            </div>

            {/* An unlocked device keeps the footer, so "Forget this device" is reachable with an empty basket. */}
            {(items.length > 0 || hasCustomer || pd?.store.session === "unlocked") && (
              <footer
                className={`drawer__foot ${props.stale && items.length > 0 ? "is-stale" : ""} ${pd ? "has-pd" : ""}`}
              >
                {items.length > 0 && (
                  <>
                    <div className="groups-head">
                      <h3 className="groups-title">Totals</h3>
                      {attention > 0 ? (
                        <span className="groups-note">
                          Leaves out {attention} {attention === 1 ? "job that needs" : "jobs that need"} attention
                        </span>
                      ) : (
                        priced > 0 &&
                        props.groups.length > 1 && (
                          <span className="groups-note">Each frequency is totalled on its own</span>
                        )
                      )}
                    </div>
                    {props.groups.length > 0 ? (
                      <ul className="groups">
                        {props.groups.map((g) => (
                          <li key={`${g.basis}-${g.frequency ?? "x"}`} className="group">
                            <span className="group__label">
                              {g.label}
                              <small>
                                {g.items} {g.items === 1 ? "job" : "jobs"}
                              </small>
                            </span>
                            <span className="group__total">
                              <b>{formatPence(g.total)}</b>
                              {g.basis === "per_visit" && <span>{g.suffix}</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="groups-empty">
                        {props.loading || !props.hasPriced
                          ? "Working out the totals…"
                          : "No priced jobs yet. Fix the jobs marked above to see totals."}
                      </p>
                    )}
                  </>
                )}
                {pd && (
                  <PipedriveSend
                    store={pd.store}
                    requests={requests}
                    customer={cust}
                    check={check}
                    fingerprint={fingerprint}
                    onAddDetails={addDetails}
                    onStartNext={() => {
                      setConfirmClear(false);
                      pd.onStartNext();
                      dialogRef.current?.focus();
                    }}
                  />
                )}
                {confirmClear ? (
                  <div className="clear-confirm" role="group" aria-label="Confirm clearing the basket">
                    <span>
                      {items.length === 0
                        ? "Clear the customer details?"
                        : `Remove all ${items.length} ${items.length === 1 ? "job" : "jobs"}${
                            hasCustomer ? " and the customer details" : " from the basket"
                          }?`}
                    </span>
                    <div className="clear-confirm__btns">
                      <button
                        type="button"
                        className="btn btn--danger btn--small"
                        onClick={() => {
                          setConfirmClear(false);
                          props.onClear();
                          dialogRef.current?.focus();
                        }}
                      >
                        Clear basket
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost-on-blue btn--small"
                        ref={keepRef}
                        onClick={() => {
                          setConfirmClear(false);
                          window.setTimeout(() => clearRef.current?.focus(), 0);
                        }}
                      >
                        {items.length === 0 ? "Keep details" : "Keep jobs"}
                      </button>
                    </div>
                  </div>
                ) : (
                  (items.length > 0 || hasCustomer) && (
                  <div className="drawer__actions">
                    <CopyButton
                      text={record}
                      label="Copy basket for records"
                      textLabel="Basket summary for records"
                      variant={pd ? "secondary" : "primary"}
                    />
                    {/* Once sent, "Start next customer" does the clearing; nothing is cleared mid-send. */}
                    {!sentHere && (
                      <button
                        type="button"
                        className="btn btn--ghost-on-blue drawer__clear"
                        ref={clearRef}
                        disabled={pdSending}
                        onClick={() => {
                          setConfirmClear(true);
                          window.setTimeout(() => keepRef.current?.focus(), 0);
                        }}
                      >
                        Clear basket
                      </button>
                    )}
                  </div>
                  )
                )}
              </footer>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {props.toast}
    </div>
  );
}

function BasketRow({
  p,
  n,
  editing,
  reduced,
  onEdit,
  onRemove,
}: {
  p: PricedItem;
  n: number;
  editing: boolean;
  reduced: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const title = itemTitle(p);
  const q = p.result?.ok ? p.result.quote : null;
  const attention = !!p.result && !p.result.ok;
  const isWin = p.item.request.quote_type === "windows";
  return (
    <motion.li
      className={`bitem ${attention ? "is-attention" : ""} ${editing ? "is-editing" : ""}`}
      layout={reduced ? false : "position"}
      initial={reduced ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={
        reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, x: 24, transition: { duration: 0.18 } }
      }
      transition={{ duration: 0.22 }}
    >
      <span className="bitem__num" aria-hidden="true">
        {n}
      </span>
      <div className="bitem__main">
        <div className="bitem__tags">
          <span className={`tag ${isWin ? "tag--windows" : "tag--gutters"}`}>{isWin ? "Windows" : "Gutters"}</span>
          {editing && <span className="tag tag--editing">Editing</span>}
          {attention && <span className="tag tag--attention">Needs attention</span>}
        </div>
        <p className="bitem__title">
          <span className="sr-only">Item {n}: </span>
          {title}
        </p>
        {q?.override && <p className="bitem__override">Override: {q.override.reason}</p>}
        {attention && (
          <ul className="bitem__errors">
            {p.result!.errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        )}
        <div className="bitem__actions">
          <button
            type="button"
            className="bitem__btn bitem__btn--edit"
            onClick={onEdit}
            aria-label={`Edit item ${n}, ${title}`}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10.8 2.7l2.5 2.5L6 12.5l-3.2.7.7-3.2Z" />
            </svg>
            Edit
          </button>
          <button type="button" className="bitem__btn" onClick={onRemove} aria-label={`Remove item ${n}, ${title}`}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" />
            </svg>
            Remove
          </button>
        </div>
      </div>
      <div className="bitem__price">
        {q ? (
          <>
            {q.override && (
              <s className="bitem__was" aria-label={`calculated ${formatPence(q.subtotal)}`}>
                {formatPence(q.subtotal)}
              </s>
            )}
            <b>{formatPence(q.total)}</b>
            <span>{q.basis === "per_visit" ? "per visit" : "one-off"}</span>
          </>
        ) : attention ? (
          <b className="bitem__nil">Not priced</b>
        ) : (
          <b className="bitem__nil">…</b>
        )}
      </div>
    </motion.li>
  );
}

function EmptyBasket({ onStart }: { onStart: () => void }) {
  return (
    <div className="basket-empty">
      <svg className="basket-empty__art" viewBox="0 0 240 64" aria-hidden="true">
        <line x1="8" x2="232" y1="32" y2="32" />
        {[0, 1, 2, 3, 4].map((i) => (
          <circle key={i} cx={22 + i * 26} cy="32" r="12" />
        ))}
        <circle cx="218" cy="32" r="12" className="is-amber" />
      </svg>
      <h3 className="basket-empty__title">Nothing in the basket yet</h3>
      <p>
        Price a job in either tab, then press <b>Add to basket</b>. Window and gutter jobs can go in together, and
        totals are kept per frequency.
      </p>
      <button type="button" className="btn btn--primary" onClick={onStart}>
        Start pricing
      </button>
    </div>
  );
}

/* ---------- Undo toast ---------- */

export function UndoToast({
  removed,
  onUndo,
  onDone,
  duration = 5000,
}: {
  removed: Removed | null;
  onUndo: () => void;
  onDone: () => void;
  duration?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const [paused, setPaused] = useState(false);
  const left = useRef(duration);
  const started = useRef(0);

  // Restart the countdown for each removal; pause while hovered or focused.
  useEffect(() => {
    left.current = duration;
    setPaused(false);
  }, [removed, duration]);
  useEffect(() => {
    if (!removed || paused) return;
    started.current = performance.now();
    const t = window.setTimeout(onDone, left.current);
    return () => {
      window.clearTimeout(t);
      left.current = Math.max(800, left.current - (performance.now() - started.current));
    };
  }, [removed, paused, onDone]);

  return (
    <AnimatePresence>
      {removed && (
        <motion.div
          key={removed.item.id}
          className={`toast ${paused ? "is-paused" : ""}`}
          role="status"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
          transition={{ duration: reduced ? 0 : 0.2 }}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
          style={{ ["--toast-ms" as string]: `${duration}ms` }}
        >
          <p className="toast__text">
            Removed <b>{removed.title}</b>
          </p>
          <button type="button" className="toast__undo" onClick={onUndo}>
            Undo
          </button>
          <span className="toast__timer" aria-hidden="true" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
