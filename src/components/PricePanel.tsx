import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";
import { copyText } from "../clipboard";
import { formatPence } from "../format";
import { useCountUp, usePrefersReducedMotion } from "../hooks";
import type { OverrideState } from "../state";
import type { FieldError, Frequency, QuoteResponse } from "../types";
import { FieldMessage, MoneyInput } from "./controls";

interface Props {
  title: string;
  result: QuoteResponse | null;
  errors: FieldError[];
  /** Errors not shown beside a form field. */
  looseErrors: FieldError[];
  loading: boolean;
  unreachable: boolean;
  onRetry: () => void;
  onFrequency?: (f: Frequency) => void;
  override: OverrideState;
  onOverride: (o: OverrideState) => void;
  overrideErrors: { total?: string; reason?: string };
  compact: boolean;
  /** The request behind `result` is the one the form currently describes. */
  current: boolean;
  basket: BasketActionProps;
}

function AnimatedTotal({ pence }: { pence: number }) {
  const shown = useCountUp(pence);
  return <>{formatPence(shown)}</>;
}

export function PricePanel(props: Props) {
  const { result, errors, looseErrors, loading, unreachable, onRetry, compact } = props;
  const [expanded, setExpanded] = useState(false);
  const reduced = usePrefersReducedMotion();
  const bodyId = useId();

  // Errors only in the override fields: keep showing the calculated price while staff finish typing.
  const overrideOnly = errors.length > 0 && errors.every((e) => e.field.startsWith("override"));
  const blocked = errors.length > 0 && !overrideOnly;
  const showResult = result && !blocked;
  const stale = (loading || unreachable) && !!result;
  const hasOverride = !!(showResult && result.override && !overrideOnly);
  const shownTotal = showResult ? (overrideOnly ? result.subtotal : result.total) : 0;

  // Collapse the sheet when switching back to desktop.
  useEffect(() => {
    if (!compact) setExpanded(false);
  }, [compact]);

  // Escape closes the expanded sheet.
  useEffect(() => {
    if (!compact || !expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compact, expanded]);

  const totalText = showResult ? formatPence(shownTotal) : "";
  // Only a fresh, fully valid quote (override included) can go in the basket.
  const ready = !!result && errors.length === 0 && !loading && !unreachable && props.current;

  return (
    <>
      {compact && expanded && <div className="sheet-scrim" aria-hidden="true" onClick={() => setExpanded(false)} />}
      <aside
        className={`panel ${compact ? "panel--sheet" : ""} ${expanded ? "is-expanded" : ""} ${stale ? "is-stale" : ""} ${overrideOnly ? "is-pending" : ""}`}
        aria-label={`${props.title} price`}
      >
        {compact && (
          <button
            type="button"
            className="sheet-bar"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={() => setExpanded((v) => !v)}
          >
            <span className="sheet-bar__total">
              {showResult ? <AnimatedTotal pence={shownTotal} /> : blocked ? "Details needed" : "…"}
            </span>
            <span className="sheet-bar__basis">
              {showResult ? result.basis_label : blocked ? "Check the form" : ""}
            </span>
            <span className="sheet-bar__toggle">
              {expanded ? "Hide" : "Breakdown"}
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 10l4-4 4 4" />
              </svg>
            </span>
          </button>
        )}

        <div className="panel__body" id={bodyId} hidden={compact && !expanded}>
          <div className="panel__head">
            <span className="panel__title">{props.title}</span>
            <span className={`panel__status ${loading ? "is-on" : ""}`} aria-hidden="true">
              <span className="pulse" />
              Updating
            </span>
          </div>

          {/* Total */}
          <div className={`total ${compact ? "" : "total--with-action"}`} aria-live="polite" aria-atomic="true">
            <span className="sr-only">{showResult ? `Total ${totalText}, ${result.basis_label}` : ""}</span>
            {hasOverride && (
              <div className="total__was" aria-hidden="true">
                <s>{formatPence(result.subtotal)}</s>
                <span>calculated</span>
              </div>
            )}
            <div
              className={`total__figure ${shownTotal >= 1_000_000 ? "is-xlong" : shownTotal >= 100_000 ? "is-long" : ""}`}
              aria-hidden="true"
            >
              {showResult ? <AnimatedTotal pence={shownTotal} /> : <span className="total__dash">£–</span>}
            </div>
            <div className="total__basis" aria-hidden="true">
              {showResult
                ? result.basis_label
                : blocked
                  ? "Fill in the highlighted details to see the price"
                  : "Working it out"}
            </div>
            {hasOverride && <p className="total__reason">Override: {result.override!.reason}</p>}
            {overrideOnly && <p className="total__pending">Override not applied: finish the details below.</p>}
          </div>
          {!compact && <BasketAction action={props.basket} ready={ready} />}

          {unreachable && (
            <div className="notice notice--offline" role="alert">
              <p>
                <strong>Can't reach the price service.</strong>{" "}
                {result ? "Showing the last price worked out." : "Check the connection and try again."}
              </p>
              <button type="button" className="btn btn--on-blue btn--small" onClick={onRetry}>
                Try again
              </button>
            </div>
          )}

          {blocked && looseErrors.length > 0 && (
            <ul className="notice notice--error">
              {looseErrors.map((e, i) => (
                <li key={i}>{e.message}</li>
              ))}
            </ul>
          )}

          {/* Warnings */}
          <AnimatePresence initial={false}>
            {showResult &&
              result.warnings.map((w) => (
                <motion.div
                  key={w.key}
                  className="warning"
                  role="note"
                  initial={reduced ? false : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
                >
                  <div className="warning__inner">
                    <svg viewBox="0 0 20 20" aria-hidden="true" className="warning__icon">
                      <path d="M10 2.5 18.2 17H1.8Z" />
                      <path d="M10 8v4M10 14.4v.1" />
                    </svg>
                    <span>{w.message}</span>
                  </div>
                </motion.div>
              ))}
          </AnimatePresence>

          {/* Lines */}
          {showResult && (
            <div className="lines">
              <ul className="lines__list">
                <AnimatePresence initial={false}>
                  {result.lines.map((l, i) => (
                    <motion.li
                      key={l.key || `line-${i}`}
                      className="line"
                      layout={reduced ? false : "position"}
                      initial={reduced ? false : { opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={
                        reduced
                          ? { opacity: 0, transition: { duration: 0 } }
                          : { opacity: 0, x: 8, transition: { duration: 0.14 } }
                      }
                      transition={{ duration: 0.22, delay: reduced ? 0 : Math.min(i, 6) * 0.015 }}
                    >
                      <span className="line__label">{l.label}</span>
                      <span className="line__leader" aria-hidden="true" />
                      <span className={`line__amount ${l.amount === null ? "is-tbc" : ""}`}>
                        {l.amount === null ? "TBC" : formatPence(l.amount)}
                      </span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
              {(result.lines.length > 1 || hasOverride) && (
                <div className="lines__sum">
                  <span>{hasOverride ? "Calculated" : "Total"}</span>
                  <span className={hasOverride ? "is-struck" : ""}>{formatPence(result.subtotal)}</span>
                </div>
              )}
            </div>
          )}

          {/* Frequency comparison */}
          {showResult && result.comparison && props.onFrequency && (
            <Comparison items={result.comparison} onPick={props.onFrequency} />
          )}

          <OverrideControl value={props.override} onChange={props.onOverride} errors={props.overrideErrors} />
        </div>

        <div className="panel__foot" hidden={compact && !expanded}>
          {compact && <BasketAction action={props.basket} ready={ready} />}
          <CopyButton text={showResult && !overrideOnly && !unreachable ? result.summary_text : null} />
        </div>
      </aside>
    </>
  );
}

/* ---------- Frequency comparison: beads on a rail ---------- */

function Comparison({
  items,
  onPick,
}: {
  items: NonNullable<QuoteResponse["comparison"]>;
  onPick: (f: Frequency) => void;
}) {
  const labelId = useId();
  return (
    <div className="compare">
      <p className="compare__label" id={labelId}>
        Same job, other frequencies
      </p>
      <div className="compare__rail" role="group" aria-labelledby={labelId}>
        {items.map((c) => (
          <button
            key={c.frequency}
            type="button"
            className={`bead ${c.selected ? "is-selected" : ""}`}
            aria-pressed={c.selected}
            aria-label={`${c.label}: ${formatPence(c.total)} per visit${c.selected ? " (selected)" : ""}`}
            onClick={() => onPick(c.frequency)}
          >
            <span className="bead__freq">
              <b>{c.frequency}</b> wk
            </span>
            <span className="bead__price">{formatPence(c.total)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- Override ---------- */

function OverrideControl({
  value,
  onChange,
  errors,
}: {
  value: OverrideState;
  onChange: (o: OverrideState) => void;
  errors: { total?: string; reason?: string };
}) {
  const reasonId = useId();
  const bodyId = useId();
  const reduced = usePrefersReducedMotion();
  return (
    <div className={`override ${value.open ? "is-open" : ""}`}>
      <button
        type="button"
        className="override__toggle"
        aria-expanded={value.open}
        aria-controls={bodyId}
        onClick={() => onChange({ ...value, open: !value.open })}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="override__chev">
          <path d="M6 4l4 4-4 4" />
        </svg>
        Override total
        {value.open && (value.total || value.reason) && <span className="override__badge">On</span>}
      </button>
      <AnimatePresence initial={false}>
        {value.open && (
          <motion.div
            id={bodyId}
            className="override__body"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="override__fields">
              <MoneyInput
                label="New total"
                value={value.total}
                onChange={(t) => onChange({ ...value, total: t })}
                error={errors.total}
                autoFocus
              />
              <div className={`field field--grow ${errors.reason ? "has-error" : ""}`}>
                <label htmlFor={reasonId} className="field-label">
                  Reason (required)
                </label>
                <input
                  id={reasonId}
                  className="text-input"
                  type="text"
                  autoComplete="off"
                  placeholder="e.g. Regular customer rate"
                  value={value.reason}
                  aria-invalid={!!errors.reason}
                  onChange={(e) => onChange({ ...value, reason: e.target.value })}
                />
                {errors.reason && <FieldMessage tone="error">{errors.reason}</FieldMessage>}
              </div>
            </div>
            <button type="button" className="link-btn" onClick={() => onChange({ open: false, total: "", reason: "" })}>
              Remove override
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------- Copy ---------- */

export function CopyButton({
  text,
  label = "Copy for records",
  textLabel = "Quote summary for records",
  variant = "secondary",
}: {
  text: string | null;
  label?: string;
  textLabel?: string;
  variant?: "primary" | "secondary";
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => setState("idle"), [text]);

  return (
    <div className="copy">
      <button
        type="button"
        className={`btn btn--copy btn--copy-${variant} ${state === "copied" ? "is-done" : ""}`}
        disabled={!text}
        onClick={async () => {
          if (!text) return;
          const ok = await copyText(text);
          setState(ok ? "copied" : "failed");
          window.clearTimeout(timer.current);
          if (ok) timer.current = window.setTimeout(() => setState("idle"), 2200);
        }}
      >
        {state === "copied" ? (
          <>
            Copied
            <svg viewBox="0 0 16 16" aria-hidden="true" className="btn__icon">
              <path d="M3 8.5l3.2 3L13 4.5" />
            </svg>
          </>
        ) : (
          <>
            <svg viewBox="0 0 16 16" aria-hidden="true" className="btn__icon">
              <rect x="5" y="5" width="8.5" height="8.5" rx="1.5" />
              <path d="M10.5 3H4a1.5 1.5 0 0 0-1.5 1.5V11" />
            </svg>
            {label}
          </>
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {state === "copied" ? "Copied to clipboard" : state === "failed" ? "Copy failed" : ""}
      </span>
      {state === "failed" && text && (
        <div className="copy__fallback">
          <p className="copy__fail">
            This browser blocked copying. The text is selected below: press Ctrl+C to copy it.
          </p>
          <textarea
            className="copy__text"
            readOnly
            aria-label={textLabel}
            value={text}
            rows={6}
            ref={(el) => {
              if (el && document.activeElement !== el) {
                el.focus();
                el.select();
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

/* ---------- Add to basket / Update item ---------- */

export interface BasketActionProps {
  mode: "add" | "update";
  /** 1-based position of the item being edited. */
  itemNumber: number | null;
  /** Items in the basket now. */
  count: number;
  /** The basket has no room for another item. */
  full: boolean;
  /** Commit the current quote. Return false if nothing was committed. */
  onCommit: (from: HTMLElement) => boolean;
  onCancel: () => void;
  onOpen: () => void;
}

function BasketAction({ action, ready }: { action: BasketActionProps; ready: boolean }) {
  const [flash, setFlash] = useState<null | "add" | "update">(null);
  const timer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const isUpdate = action.mode === "update";
  const blockedByFull = !isUpdate && action.full;
  const disabled = !ready || blockedByFull;

  return (
    <div className="bact">
      <button
        type="button"
        className={`btn btn--basket ${flash ? "is-done" : ""}`}
        disabled={disabled && !flash}
        aria-disabled={flash ? true : undefined}
        onClick={(e) => {
          if (flash || disabled) return;
          const kind = action.mode;
          if (!action.onCommit(e.currentTarget)) return;
          setFlash(kind);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setFlash(null), 1400);
        }}
      >
        {flash ? (
          <>
            {flash === "add" ? "Added" : "Updated"}
            <svg viewBox="0 0 16 16" aria-hidden="true" className="btn__icon">
              <path d="M3 8.5l3.2 3L13 4.5" />
            </svg>
          </>
        ) : isUpdate ? (
          <>
            <svg viewBox="0 0 16 16" aria-hidden="true" className="btn__icon">
              <path d="M2.8 6.2A5.5 5.5 0 1 1 2.5 9.5" />
              <path d="M2.5 2.8v3.6h3.6" />
            </svg>
            Update item {action.itemNumber}
          </>
        ) : (
          <>
            <svg viewBox="0 0 20 20" aria-hidden="true" className="btn__icon btn__icon--basket">
              <path d="M3 7.5h14l-1.4 8.2a1.6 1.6 0 0 1-1.6 1.3H6a1.6 1.6 0 0 1-1.6-1.3Z" />
              <path d="M7 7.5 9 3M13 7.5 11 3" />
              <path d="M10 10.2v4M8 12.2h4" />
            </svg>
            Add to basket
          </>
        )}
      </button>
      {blockedByFull && <p className="bact__note">The basket is full ({action.count} items).</p>}
      <div className="bact__links">
        {isUpdate && !flash && (
          <button type="button" className="link-btn" onClick={action.onCancel}>
            Cancel edit
          </button>
        )}
        {action.count > 0 && (
          <button type="button" className="link-btn bact__view" data-basket-target="panel" onClick={action.onOpen}>
            View basket ({action.count} {action.count === 1 ? "item" : "items"})
          </button>
        )}
      </div>
    </div>
  );
}
