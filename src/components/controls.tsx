import {
  useId,
  useRef,
  useState,
  type FocusEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";

/* ---------- Segmented control (radio group with roving focus) ---------- */

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  sub?: ReactNode;
  /** Accessible name when the visible label is terse. */
  aria?: string;
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  labelHidden = false,
  size = "md",
  describedBy,
  allowDeselect = false,
  layout = "fill",
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  labelHidden?: boolean;
  size?: "md" | "lg";
  describedBy?: string;
  /** Clicking the selected option again clears the choice (onChange receives ""). Use a T that includes "". */
  allowDeselect?: boolean;
  /** "fill": equal-width tray (default). "wrap": separate chips that wrap onto more lines. */
  layout?: "fill" | "wrap";
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const labelId = useId();
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const move = (e: KeyboardEvent, i: number) => {
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % options.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + options.length) % options.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div className="seg-wrap">
      <span id={labelId} className={labelHidden ? "sr-only" : "field-label"}>
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        className={`seg seg--${size}${layout === "wrap" ? " seg--wrap" : ""}`}
        style={{ ["--n" as string]: options.length }}
      >
        {options.map((o, i) => {
          const checked = o.value === value;
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={i === index ? 0 : -1}
              className="seg__opt"
              aria-label={o.aria}
              onClick={() => onChange(allowDeselect && checked ? ("" as T) : o.value)}
              onKeyDown={(e) => move(e, i)}
            >
              <span className="seg__label">{o.label}</span>
              {o.sub != null && <span className="seg__sub">{o.sub}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Stepper ---------- */

export function Stepper({
  label,
  ariaLabel,
  hint,
  value,
  onChange,
  min = 0,
  max = 99,
  error,
}: {
  label: string;
  ariaLabel?: string;
  hint?: ReactNode;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  error?: string;
}) {
  const id = useId();
  const name = ariaLabel ?? label;
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className={`stepper ${value > 0 ? "is-active" : ""} ${error ? "has-error" : ""}`}>
      <label htmlFor={id} className="stepper__label">
        {label}
        {hint && <span className="stepper__hint">{hint}</span>}
      </label>
      <div className="stepper__ctrl">
        <button
          type="button"
          className="stepper__btn"
          aria-label={`Decrease ${name}`}
          onClick={() => onChange(clamp(value - 1))}
          disabled={value <= min}
          tabIndex={-1}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 8h9" />
          </svg>
        </button>
        <input
          id={id}
          className="stepper__input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={String(value)}
          aria-label={ariaLabel}
          aria-invalid={!!error}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            onChange(clamp(digits === "" ? 0 : Number(digits)));
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              onChange(clamp(value + 1));
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              onChange(clamp(value - 1));
            }
          }}
        />
        <button
          type="button"
          className="stepper__btn"
          aria-label={`Increase ${name}`}
          onClick={() => onChange(clamp(value + 1))}
          disabled={value >= max}
          tabIndex={-1}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 8h9M8 3.5v9" />
          </svg>
        </button>
      </div>
      {error && <FieldMessage tone="error">{error}</FieldMessage>}
    </div>
  );
}

/* ---------- Switch ---------- */

export function Switch({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const descId = useId();
  return (
    <div className={`switch-row ${disabled ? "is-disabled" : ""}`}>
      <div className="switch-row__text">
        <label htmlFor={id} className="switch-row__label">
          {label}
        </label>
        {description && (
          <span id={descId} className="switch-row__desc">
            {description}
          </span>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? descId : undefined}
        disabled={disabled}
        className="switch"
        onClick={() => onChange(!checked)}
      >
        <span className="switch__thumb" />
      </button>
    </div>
  );
}

/* ---------- Money input (pounds) ---------- */

/** Keep only digits and one decimal point, max two decimals. */
export function sanitisePounds(text: string): string {
  let t = text.replace(/[^\d.]/g, "");
  const dot = t.indexOf(".");
  if (dot !== -1)
    t =
      t.slice(0, dot + 1) +
      t
        .slice(dot + 1)
        .replace(/\./g, "")
        .slice(0, 2);
  return t.slice(0, 9);
}

export function MoneyInput({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder = "0.00",
  compact = false,
  labelHidden = false,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: ReactNode;
  placeholder?: string;
  compact?: boolean;
  labelHidden?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const msgId = useId();
  const [touched, setTouched] = useState(false);
  // A required field nobody has filled in yet is a prompt, not a mistake.
  const soft = !!error && !touched && value === "";
  return (
    <div
      className={`field ${compact ? "field--compact" : ""} ${error && !soft ? "has-error" : ""} ${soft ? "is-needed" : ""}`}
    >
      <label htmlFor={id} className={labelHidden ? "sr-only" : "field-label"}>
        {label}
      </label>
      <div className="money">
        <span className="money__sym" aria-hidden="true">
          £
        </span>
        <input
          id={id}
          className="money__input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          autoFocus={autoFocus}
          aria-invalid={!!error}
          aria-describedby={error || hint ? msgId : undefined}
          onBlur={() => setTouched(true)}
          onChange={(e) => {
            setTouched(true);
            onChange(sanitisePounds(e.target.value));
          }}
        />
      </div>
      <div id={msgId}>
        {error ? (
          <FieldMessage tone={soft ? "needed" : "error"}>{error}</FieldMessage>
        ) : hint ? (
          <p className="field-hint">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- Text input ---------- */

export function TextInput({
  label,
  value,
  onChange,
  error,
  placeholder,
  autoFocus,
  type = "text",
  inputMode,
  autoCapitalize,
  enterKeyHint,
  spellCheck,
  maxLength,
  onBlur,
  onFocus,
  note,
  className = "",
  revealable = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  placeholder?: string;
  autoFocus?: boolean;
  type?: "text" | "tel" | "email" | "password";
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  autoCapitalize?: string;
  enterKeyHint?: HTMLAttributes<HTMLInputElement>["enterKeyHint"];
  spellCheck?: boolean;
  maxLength?: number;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  onFocus?: (e: FocusEvent<HTMLInputElement>) => void;
  /** Shown under the field when there's no error (a hint, a soft warning, a suggestion). */
  note?: ReactNode;
  /** Extra classes on the field wrapper. */
  className?: string;
  /** Password fields only: an eye button to show what's been typed, to check it before submitting. */
  revealable?: boolean;
}) {
  const id = useId();
  const msgId = useId();
  const [touched, setTouched] = useState(false);
  const [shown, setShown] = useState(false);
  const canReveal = revealable && type === "password";
  const soft = !!error && !touched && value.trim() === "";
  const message = error ? <FieldMessage tone={soft ? "needed" : "error"}>{error}</FieldMessage> : note;
  return (
    <div className={`field field--grow ${error && !soft ? "has-error" : ""} ${soft ? "is-needed" : ""} ${className}`}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className={canReveal ? "text-input-wrap" : "text-input-plain"}>
      <input
        id={id}
        className="text-input"
        type={canReveal && shown ? "text" : type}
        inputMode={inputMode}
        autoCapitalize={autoCapitalize}
        enterKeyHint={enterKeyHint}
        spellCheck={spellCheck}
        maxLength={maxLength}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-invalid={!!error}
        aria-describedby={message ? msgId : undefined}
        onFocus={onFocus}
        onBlur={(e) => {
          setTouched(true);
          onBlur?.(e);
        }}
        onChange={(e) => {
          setTouched(true);
          onChange(e.target.value);
        }}
      />
      {canReveal && (
        <button
          type="button"
          className="reveal-btn"
          aria-controls={id}
          aria-pressed={shown}
          aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          title={shown ? "Hide" : "Show what you've typed"}
          onClick={() => setShown(!shown)}
        >
          {shown ? (
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z" />
              <circle cx="10" cy="10" r="2.4" />
              <path d="M3.5 3.5l13 13" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z" />
              <circle cx="10" cy="10" r="2.4" />
            </svg>
          )}
        </button>
      )}
      </div>
      {message && <div id={msgId}>{message}</div>}
    </div>
  );
}

/* ---------- Messages ---------- */

export function FieldMessage({ tone, children }: { tone: "error" | "warning" | "needed"; children: ReactNode }) {
  return (
    <p className={`field-msg field-msg--${tone}`} role={tone === "error" ? "alert" : undefined}>
      <svg viewBox="0 0 16 16" aria-hidden="true" className="field-msg__icon">
        {tone === "needed" ? (
          <path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7" />
        ) : tone === "error" ? (
          <>
            <circle cx="8" cy="8" r="6.5" />
            <path d="M8 4.8v3.6M8 10.9v.1" />
          </>
        ) : (
          <>
            <path d="M8 2.2 14.4 13.5H1.6Z" />
            <path d="M8 6.4v3.2M8 11.4v.1" />
          </>
        )}
      </svg>
      <span>{children}</span>
    </p>
  );
}

/* ---------- Section ---------- */

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="section" aria-labelledby={id}>
      <div className="section__head">
        <h2 id={id} className="section__title">
          {title}
        </h2>
        {aside && <div className="section__aside">{aside}</div>}
      </div>
      <div className="section__body">{children}</div>
    </section>
  );
}
