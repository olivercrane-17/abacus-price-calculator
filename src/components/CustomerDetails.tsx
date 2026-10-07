import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  capitaliseWords,
  CONTACT_METHODS,
  customerSummary,
  emailTypoSuggestion,
  formatPostcodeAsTyped,
  formatUkPhone,
  HEARD_VIA,
  isFullPostcode,
  phoneLooksValid,
  usePostcodeLookup,
  type ContactMethod,
  type Customer,
  type CustomerStore,
  type HeardVia,
  type LookupState,
} from "../customer";
import type { AddressLookup } from "../types";
import { FieldMessage, Segmented, TextInput } from "./controls";
import { Reveal } from "./WindowsForm";

const NEXT_FIELD = 'input:not([disabled]):not([readonly]), textarea, select, [role="radio"][tabindex="0"]';

/** Enter in a one-line field moves on to the next field (it never submits anything). */
function enterMovesOn(e: KeyboardEvent<HTMLDivElement>) {
  const el = e.target as HTMLElement;
  if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
  if (el.tagName !== "INPUT" && el.tagName !== "SELECT") return;
  e.preventDefault();
  const fields = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(NEXT_FIELD)).filter(
    (n) => n.offsetParent !== null,
  );
  const next = fields[fields.indexOf(el) + 1];
  next?.focus();
}

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");

/** Errors the server sent back for the customer (from Send to Pipedrive). */
export type CustomerErrors = Partial<Record<"name" | "phone", string>>;

export function CustomerDetails({
  store,
  open,
  onToggle,
  onClear,
  errors,
  sendsToPipedrive = false,
  alwaysOpen = false,
}: {
  store: CustomerStore;
  open: boolean;
  /** Full-screen basket: the section can't be collapsed, so the heading isn't a toggle. */
  alwaysOpen?: boolean;
  onToggle: (open: boolean) => void;
  onClear: () => void;
  errors?: CustomerErrors;
  /** Send to Pipedrive is switched on, so the privacy note says the details can leave this tab. */
  sendsToPipedrive?: boolean;
}) {
  const { customer: c, set, isEmpty } = store;
  const bodyId = useId();
  const headId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const summary = customerSummary(c);
  const ini = initials(c.name);

  return (
    <section className={`cust ${open ? "is-open" : ""} ${isEmpty ? "" : "has-details"}`} aria-labelledby={headId}>
      <h3 className="cust__heading" id={headId}>
        <Toggle alwaysOpen={alwaysOpen} open={open} bodyId={bodyId} onToggle={onToggle}>
          <span className="cust__bead" aria-hidden="true">
            {ini || (
              <svg viewBox="0 0 20 20">
                <circle cx="10" cy="7" r="3.2" />
                <path d="M3.8 16.5a6.2 6.2 0 0 1 12.4 0" />
              </svg>
            )}
          </span>
          <span className="cust__text">
            <span className="cust__title">Customer details</span>
            <span className="cust__sum">
              {summary || (isEmpty ? "Optional. Added to the copied record." : "Details added")}
            </span>
          </span>
          {!alwaysOpen && (
            <svg className="cust__chev" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 6l4 4 4-4" />
            </svg>
          )}
        </Toggle>
      </h3>
      <Reveal show={open}>
        <div className="cust__body" id={bodyId} onKeyDown={enterMovesOn} ref={bodyRef}>
          <CustomerFields c={c} set={set} errors={errors} />
          <div className="cust__foot">
            <p className="cust__privacy">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <rect x="3.5" y="7" width="9" height="6.5" rx="1.3" />
                <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
              </svg>
              {sendsToPipedrive
                ? "Kept in this tab only, and cleared when it closes, unless you send it to Pipedrive."
                : "Kept in this tab only, and cleared when it closes."}
            </p>
            {!isEmpty && (
              <button
                type="button"
                className="link-btn cust__clear"
                onClick={() => {
                  onClear();
                  window.setTimeout(() => bodyRef.current?.querySelector<HTMLInputElement>("input")?.focus(), 0);
                }}
              >
                Clear details
              </button>
            )}
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/** The section heading: a collapse toggle, or plain when the section always stays open. */
function Toggle({
  alwaysOpen,
  open,
  bodyId,
  onToggle,
  children,
}: {
  alwaysOpen: boolean;
  open: boolean;
  bodyId: string;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  if (alwaysOpen) return <div className="cust__toggle is-static">{children}</div>;
  return (
    <button
      type="button"
      className="cust__toggle"
      aria-expanded={open}
      aria-controls={open ? bodyId : undefined}
      onClick={() => onToggle(!open)}
    >
      {children}
    </button>
  );
}

function CustomerFields({
  c,
  set,
  errors,
}: {
  c: Customer;
  set: (p: Partial<Customer>) => void;
  errors?: CustomerErrors;
}) {
  const [pcBlurred, setPcBlurred] = useState(false);
  const [phoneBlurred, setPhoneBlurred] = useState(false);
  const [emailBlurred, setEmailBlurred] = useState(false);
  const line1Ref = useRef<HTMLDivElement>(null);
  const otherRef = useRef<HTMLDivElement>(null);

  // Fill the town from the lookup only if it's empty or was filled by an earlier lookup.
  const onResult = (r: AddressLookup) => {
    if (r.valid) {
      const patch: Partial<Customer> = { county: r.county ?? "" };
      if ((c.town.trim() === "" || c.townAuto) && r.town) {
        patch.town = r.town;
        patch.townAuto = true;
      }
      set(patch);
    } else if (r.valid === false) {
      set(c.townAuto ? { county: "", town: "", townAuto: false } : { county: "" });
    }
  };
  const lookup = usePostcodeLookup(c.postcode, onResult);
  const addresses = lookup.status === "found" ? lookup.result.addresses : [];

  const onPostcode = (v: string) => {
    const pc = formatPostcodeAsTyped(v);
    const patch: Partial<Customer> = { postcode: pc };
    if (!isFullPostcode(pc)) {
      patch.county = "";
      if (pc === "" && c.townAuto) {
        patch.town = "";
        patch.townAuto = false;
      }
    }
    set(patch);
  };

  const emailFix = emailTypoSuggestion(c.email);
  const emailShape = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(c.email.trim());

  return (
    <div className="cust__fields">
      <TextInput
        label="Name"
        className="cust__f-name"
        error={errors?.name}
        value={c.name}
        onChange={(v) => set({ name: capitaliseWords(v) })}
        autoCapitalize="words"
        enterKeyHint="next"
        spellCheck={false}
        maxLength={120}
      />

      <div className="cust__pc">
        <TextInput
          label="Postcode"
          className="cust__pc-field"
          value={c.postcode}
          onChange={onPostcode}
          onFocus={() => setPcBlurred(false)}
          onBlur={() => setPcBlurred(true)}
          autoCapitalize="characters"
          enterKeyHint="next"
          spellCheck={false}
          maxLength={8}
          placeholder="GU9 8AB"
        />
        <LookupStatus state={lookup} partial={pcBlurred && c.postcode.trim() !== "" && !isFullPostcode(c.postcode)} />
      </div>

      {addresses.length > 0 && (
        <AddressPicker
          options={addresses}
          onPick={(i) => {
            if (i === -1) {
              window.setTimeout(() => line1Ref.current?.querySelector("input")?.focus(), 0);
              return;
            }
            const a = addresses[i];
            set({
              line1: a.line1,
              line2: a.line2,
              town: a.town,
              townAuto: true,
              postcode: formatPostcodeAsTyped(a.postcode),
            });
          }}
        />
      )}

      <div ref={line1Ref}>
        <TextInput
          label="Address line 1"
          value={c.line1}
          onChange={(v) => set({ line1: v })}
          enterKeyHint="next"
          maxLength={120}
        />
      </div>
      <TextInput
        label="Address line 2"
        value={c.line2}
        onChange={(v) => set({ line2: v })}
        enterKeyHint="next"
        maxLength={120}
      />
      <TextInput
        label="Town"
        value={c.town}
        onChange={(v) => set({ town: v, townAuto: false })}
        enterKeyHint="next"
        maxLength={80}
        note={
          c.townAuto && c.town ? <p className="field-hint">Filled in from the postcode. Change it if needed.</p> : null
        }
      />

      <div className="cust__pair">
        <TextInput
          label="Phone"
          className="cust__f-phone"
          error={errors?.phone}
          type="tel"
          inputMode="tel"
          value={c.phone}
          onChange={(v) => set({ phone: v })}
          onFocus={() => setPhoneBlurred(false)}
          onBlur={(e) => {
            setPhoneBlurred(true);
            const f = formatUkPhone(e.target.value);
            if (f !== e.target.value) set({ phone: f });
          }}
          enterKeyHint="next"
          maxLength={30}
          note={
            phoneBlurred && !phoneLooksValid(c.phone) ? (
              <FieldMessage tone="warning">
                This doesn't look like a UK number. Check it, or leave it as typed.
              </FieldMessage>
            ) : null
          }
        />
        <TextInput
          label="Email"
          className="cust__f-email"
          type="email"
          inputMode="email"
          value={c.email}
          onChange={(v) => set({ email: v.replace(/\s/g, "") })}
          onFocus={() => setEmailBlurred(false)}
          onBlur={() => setEmailBlurred(true)}
          autoCapitalize="none"
          enterKeyHint="next"
          spellCheck={false}
          maxLength={160}
          note={
            emailFix ? (
              <p className="cust__suggest">
                Did you mean{" "}
                <button type="button" className="cust__suggest-btn" onClick={() => set({ email: emailFix })}>
                  {emailFix}
                </button>
                ?
              </p>
            ) : emailBlurred && c.email.trim() && !emailShape ? (
              <FieldMessage tone="warning">This email address looks incomplete.</FieldMessage>
            ) : null
          }
        />
      </div>

      <div className="cust__chips">
        <Segmented<ContactMethod | "">
          label="Preferred contact"
          options={CONTACT_METHODS.map((m) => ({ value: m.value, label: m.label }))}
          value={c.contactMethod}
          onChange={(v) => set({ contactMethod: v })}
          allowDeselect
          layout="wrap"
        />
      </div>

      <div className="cust__chips">
        <Segmented<HeardVia | "">
          label="How they heard of us"
          options={HEARD_VIA.map((h) => ({ value: h.value, label: h.label }))}
          value={c.heardVia}
          onChange={(v) => {
            set({ heardVia: v });
            if (v === "other") window.setTimeout(() => otherRef.current?.querySelector("input")?.focus(), 240);
          }}
          allowDeselect
          layout="wrap"
        />
        <Reveal show={c.heardVia === "other"}>
          <div ref={otherRef}>
            <TextInput
              label="Where did they hear of us?"
              value={c.heardOther}
              onChange={(v) => set({ heardOther: v })}
              placeholder="e.g. Parish magazine"
              enterKeyHint="next"
              maxLength={120}
            />
          </div>
        </Reveal>
      </div>

      <NotesField value={c.notes} onChange={(v) => set({ notes: v })} />
    </div>
  );
}

function LookupStatus({ state, partial }: { state: LookupState; partial: boolean }) {
  let body: ReactNode = null;
  if (state.status === "loading") {
    body = (
      <span className="cust__looking">
        <span className="pulse" aria-hidden="true" />
        Looking up {state.postcode}…
      </span>
    );
  } else if (state.status === "found") {
    const place = [state.result.town, state.result.county].filter(Boolean).join(", ");
    body = (
      <span className="cust__found">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 8.5l3.2 3L13 4.5" />
        </svg>
        <span>
          <span className="sr-only">Postcode found: </span>
          {place || state.result.postcode}
        </span>
      </span>
    );
  } else if (state.status === "unknown") {
    body = <FieldMessage tone="warning">We couldn't find {state.postcode}. Check it, or carry on.</FieldMessage>;
  } else if (state.status === "offline") {
    body = (
      <FieldMessage tone="warning">Postcode lookup isn't available right now. Type the town by hand.</FieldMessage>
    );
  } else if (state.status === "invalid") {
    body = <FieldMessage tone="warning">{state.message || "That doesn't look like a UK postcode."}</FieldMessage>;
  } else if (partial) {
    body = <FieldMessage tone="warning">That isn't a full UK postcode yet.</FieldMessage>;
  }
  return (
    <div className="cust__lookup" aria-live="polite" aria-atomic="true">
      {body}
    </div>
  );
}

function AddressPicker({ options, onPick }: { options: AddressLookup["addresses"]; onPick: (index: number) => void }) {
  const id = useId();
  const [value, setValue] = useState("");
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        Address
      </label>
      <select
        id={id}
        className="text-input cust__select"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (e.target.value !== "") onPick(Number(e.target.value));
        }}
      >
        <option value="">Select the address…</option>
        {options.map((a, i) => (
          <option key={i} value={i}>
            {[a.line1, a.line2, a.town].filter(Boolean).join(", ")}
          </option>
        ))}
        <option value="-1">Not listed, type it</option>
      </select>
    </div>
  );
}

function NotesField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  // Grow with the text, so nothing scrolls inside a small box.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight + 2, 84)}px`;
  }, [value]);
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        Notes
      </label>
      <textarea
        id={id}
        ref={ref}
        className="text-input cust__notes"
        autoComplete="off"
        rows={3}
        maxLength={1000}
        value={value}
        placeholder="Access, gate code, dogs, best time to call…"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
