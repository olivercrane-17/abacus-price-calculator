import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import type { Customer } from "../customer";
import { formatPence } from "../format";
import {
  customerErrorField,
  type CustomerField,
  type PipedriveStore,
  type SendCheck,
  type SentRecord,
  type UnlockResult,
} from "../pipedrive";
import type { QuoteRequest } from "../types";
import { TextInput } from "./controls";

interface Props {
  store: PipedriveStore;
  /** The basket's quote request bodies, exactly as stored. */
  requests: QuoteRequest[];
  customer: Customer;
  check: SendCheck;
  /** sendFingerprint(requests, customer), worked out by the drawer. */
  fingerprint: string;
  /** Open Customer details and focus this field. */
  onAddDetails: (field: CustomerField) => void;
  /** The drawer's clear flow: empties the basket and the customer details. */
  onStartNext: () => void;
}

const focusSoon = (ref: RefObject<HTMLElement | null>) => window.setTimeout(() => ref.current?.focus(), 0);

/** "Send to Pipedrive" in the basket drawer's footer: unlock once per device, then send, then start the next customer. */
export function PipedriveSend({ store, requests, customer, check, fingerprint, onAddDetails, onStartNext }: Props) {
  const { session, state, sent, event } = store;
  const sending = state.status === "sending";
  // Locked for this exact basket and customer once it's been sent; any change opens it up again.
  const sentHere = !sending && sent?.fingerprint === fingerprint ? sent : null;
  const sentBefore = sent && sent.fingerprint !== fingerprint ? sent : null;
  const failure = state.status === "failed" && state.fingerprint === fingerprint ? state : null;
  const invalid = state.status === "invalid" && state.fingerprint === fingerprint ? state : null;
  const unlocked = session === "unlocked";
  const blocked = !check.ok;

  const [unlocking, setUnlocking] = useState(false);
  const [expired, setExpired] = useState(false);
  const [confirmAgain, setConfirmAgain] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  // Bumped when Send is pressed while blocked for a reason that isn't a missing detail (e.g. no jobs).
  const [nudge, setNudge] = useState(0);
  const [forgetError, setForgetError] = useState("");
  const [said, setSaid] = useState("");
  const sayTimer = useRef(0);
  const sendRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLAnchorElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const reasonId = useId();
  const confirmId = useId();

  const say = useCallback((msg: string) => {
    // Clear first so a repeated message is announced again.
    setSaid("");
    window.clearTimeout(sayTimer.current);
    sayTimer.current = window.setTimeout(() => setSaid(msg), 40);
  }, []);
  useEffect(() => () => window.clearTimeout(sayTimer.current), []);

  // Nothing to confirm once the basket goes back to what was sent, or the send area changes state.
  useEffect(() => {
    if (!sentBefore || !unlocked) setConfirmAgain(false);
  }, [sentBefore, unlocked]);

  // React to what just happened (once each): announce it and put focus somewhere sensible.
  const seen = useRef(event?.id ?? 0);
  useEffect(() => {
    if (!event || event.id <= seen.current) return;
    seen.current = event.id;
    switch (event.type) {
      case "unlocked":
        setUnlocking(false);
        setExpired(false);
        say("Unlocked on this device. You can now send to Pipedrive.");
        focusSoon(sendRef);
        break;
      case "sent": {
        setConfirmAgain(false);
        const r = sent?.result;
        say(
          [
            "Sent to Pipedrive.",
            r?.person_reused ? "Added to their existing contact." : "New contact added.",
            r?.warning ?? "",
          ]
            .filter(Boolean)
            .join(" "),
        );
        window.setTimeout(() => (openRef.current ?? sendRef.current)?.focus(), 0);
        break;
      }
      case "failed":
        // The notice is role="alert" (so is the list for "invalid"): clear "Sending…" rather than repeat it.
        say("");
        // Keep focus on its Try again button (the Send button has gone).
        window.setTimeout(() => (retryRef.current ?? sendRef.current)?.focus(), 0);
        break;
      case "invalid": {
        say("");
        const f =
          state.status === "invalid"
            ? state.errors.map((e) => customerErrorField(e.field)).find((x): x is CustomerField => !!x)
            : undefined;
        if (f) onAddDetails(f);
        break;
      }
      case "expired":
        setExpired(true);
        setUnlocking(true);
        say("Not sent. This device needs the staff passcode again.");
        break;
      case "forgotten":
        setUnlocking(false);
        setExpired(false);
        say("This device is locked. Sending to Pipedrive needs the staff passcode again.");
        focusSoon(sendRef);
        break;
    }
  }, [event, sent, state, say, onAddDetails]);

  const doSend = () => {
    if (sending) return;
    say("Sending to Pipedrive…");
    void store.send(requests, customer);
  };

  const forget = async () => {
    if (forgetting) return;
    setForgetting(true);
    setForgetError("");
    const ok = await store.forget();
    setForgetting(false);
    if (!ok) setForgetError("Can't reach the server, so this device is still unlocked. Try again.");
  };

  const reason = !check.ok && !invalid && (
    <p key={nudge} className={`pd-reason ${nudge ? "is-nudged" : ""}`} id={reasonId}>
      <span className="pd-reason__bead" aria-hidden="true" />
      <span>
        {check.reason}
        {check.field && (
          <>
            {" "}
            <button type="button" className="link-btn pd-link" onClick={() => onAddDetails(check.field!)}>
              Add details
            </button>
          </>
        )}
      </span>
    </p>
  );

  const already = sentBefore && (
    <p className="pd-again">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 8.5l3.2 3L13 4.5" />
      </svg>
      <span>
        Sent to Pipedrive before these changes.{" "}
        <a className="pd-link" href={sentBefore.result.deal_url} target="_blank" rel="noopener noreferrer">
          Open that deal
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </span>
    </p>
  );

  let body: ReactNode;
  if (sentHere) {
    /* ---------- Sent: this exact basket and customer ---------- */
    body = <SentPanel record={sentHere} openRef={openRef} onStartNext={onStartNext} />;
  } else if (!unlocked) {
    /* ---------- Locked: unlock once on this device ---------- */
    body = unlocking ? (
      <UnlockForm
        expired={expired}
        onUnlock={store.unlock}
        onCancel={() => {
          setUnlocking(false);
          setExpired(false);
          focusSoon(sendRef);
        }}
      />
    ) : (
      <>
        {already}
        <button
          ref={sendRef}
          type="button"
          className="btn btn--copy btn--copy-primary pd-btn"
          aria-describedby={reason ? reasonId : undefined}
          onClick={() => setUnlocking(true)}
        >
          <LockIcon />
          Send to Pipedrive
        </button>
        {reason}
      </>
    );
  } else {
    /* ---------- Unlocked ---------- */
    body = (
      <>
        {failure ? (
          <Failure kind={failure.kind} message={failure.message} retryRef={retryRef} onRetry={doSend} />
        ) : (
          <>
            {already}
            {confirmAgain ? (
              <div className="clear-confirm pd-confirm" role="group" aria-labelledby={confirmId}>
                <span id={confirmId}>Already sent: send again? This makes a second deal in Pipedrive.</span>
                <div className="clear-confirm__btns">
                  <button
                    type="button"
                    className="btn btn--on-blue btn--small"
                    onClick={() => {
                      setConfirmAgain(false);
                      doSend();
                      focusSoon(sendRef);
                    }}
                  >
                    Send again
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost-on-blue btn--small"
                    ref={keepRef}
                    onClick={() => {
                      setConfirmAgain(false);
                      focusSoon(sendRef);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                ref={sendRef}
                type="button"
                className={`btn btn--copy btn--copy-primary pd-btn ${sending ? "is-sending" : ""}`}
                aria-disabled={blocked || sending ? true : undefined}
                aria-describedby={reason ? reasonId : undefined}
                onClick={() => {
                  if (sending) return;
                  if (blocked) {
                    // Don't just do nothing: take staff to what's missing, or draw their eye to the reason.
                    if (check.field) onAddDetails(check.field);
                    else setNudge((n) => n + 1);
                    return;
                  }
                  if (sentBefore) {
                    setConfirmAgain(true);
                    focusSoon(keepRef);
                    return;
                  }
                  doSend();
                }}
              >
                {sending ? (
                  <>
                    <span className="pd-spin" aria-hidden="true" />
                    Sending to Pipedrive…
                  </>
                ) : (
                  <>
                    <SendIcon />
                    {sentBefore ? "Send again" : "Send to Pipedrive"}
                  </>
                )}
              </button>
            )}
            {invalid && (
              <div className="pd-problems" role="alert">
                <p>Not sent. Fix these first:</p>
                <ul>
                  {invalid.errors.map((e, i) => (
                    <li key={i}>{e.message}</li>
                  ))}
                </ul>
                {invalid.errors.some((e) => customerErrorField(e.field)) && (
                  <button
                    type="button"
                    className="link-btn pd-link"
                    onClick={() => {
                      const f = invalid.errors.map((e) => customerErrorField(e.field)).find(Boolean);
                      if (f) onAddDetails(f);
                    }}
                  >
                    Add details
                  </button>
                )}
              </div>
            )}
            {reason}
          </>
        )}
        <div className="pd-device">
          <span className="pd-device__state">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="3.5" y="7" width="9" height="6.5" rx="1.3" />
              <path d="M5.5 7V5.2a2.5 2.5 0 0 1 4.9-.7" />
            </svg>
            Unlocked on this device
          </span>
          <button type="button" className="link-btn pd-link" onClick={forget} aria-disabled={forgetting || undefined}>
            {forgetting ? "Forgetting…" : "Forget this device"}
          </button>
        </div>
        {forgetError && (
          <p className="pd-device__error" role="alert">
            {forgetError}
          </p>
        )}
      </>
    );
  }

  // The live region stays in one place whatever the state, so screen readers keep listening to it.
  return (
    <div className="pd">
      {body}
      <Live text={said} />
    </div>
  );
}

/* ---------- Pieces ---------- */

function Live({ text }: { text: string }) {
  return (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {text}
    </p>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="btn__icon">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.3" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="btn__icon">
      <path d="M2.5 8 13.5 2.8 10.6 13.4 7.6 9.2Z" />
      <path d="M7.6 9.2 13.5 2.8" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="pd-ext">
      <path d="M6 3.5H3.5v9h9V10" />
      <path d="M9 3h4v4M13 3 7.5 8.5" />
    </svg>
  );
}

function UnlockForm({
  expired,
  onUnlock,
  onCancel,
}: {
  expired: boolean;
  onUnlock: (passcode: string) => Promise<UnlockResult>;
  onCancel: () => void;
}) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const input = () => formRef.current?.querySelector<HTMLInputElement>("input");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!passcode.trim()) {
      setError("Enter the staff passcode");
      input()?.focus();
      return;
    }
    setBusy(true);
    setError(undefined);
    setProblem("");
    const r = await onUnlock(passcode);
    if (r.ok) return; // the send area swaps this form for the Send button
    setBusy(false);
    if (r.kind === "wrong") {
      setError(r.message);
      window.setTimeout(() => {
        input()?.focus();
        input()?.select();
      }, 0);
    } else setProblem(r.message);
  };

  return (
    <form className="pd-unlock" ref={formRef} onSubmit={submit} aria-labelledby={titleId} noValidate>
      <p className="pd-unlock__title" id={titleId}>
        <LockIcon />
        Unlock on this device
      </p>
      <p className="pd-unlock__hint">
        {expired ? (
          <>
            <strong className="pd-unlock__warn">Not sent.</strong> This device was locked: the passcode may have
            changed, or its 30 days ran out. Enter the passcode, then send again.
          </>
        ) : (
          "Enter the staff passcode once. This device then stays unlocked for 30 days."
        )}
      </p>
      <div className="pd-unlock__row">
        <TextInput
          label="Staff passcode"
          type="password"
          className="pd-unlock__field"
          value={passcode}
          onChange={(v) => {
            setPasscode(v);
            setError(undefined);
          }}
          error={error}
          autoFocus
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={200}
        />
        <button type="submit" className="btn btn--on-blue pd-unlock__go" aria-disabled={busy || undefined}>
          {busy ? (
            <>
              <span className="pd-spin" aria-hidden="true" />
              Checking…
            </>
          ) : (
            "Unlock"
          )}
        </button>
      </div>
      {problem && (
        <p className="pd-unlock__problem" role="alert">
          {problem}
        </p>
      )}
      <button type="button" className="link-btn pd-link pd-unlock__cancel" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function SentPanel({
  record,
  openRef,
  onStartNext,
}: {
  record: SentRecord;
  openRef: RefObject<HTMLAnchorElement | null>;
  onStartNext: () => void;
}) {
  const r = record.result;
  return (
    <div className="pd-done">
      <div className="pd-done__row">
        <span className="pd-done__bead" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <path d="M3 8.5l3.2 3L13 4.5" />
          </svg>
        </span>
        <div className="pd-done__text">
          <p className="pd-done__title">Sent to Pipedrive</p>
          <p className="pd-done__meta">
            {r.person_reused ? "Added to their existing contact." : "New contact added."}{" "}
            <span className="pd-nowrap">Deal value {formatPence(r.value)}.</span>
          </p>
        </div>
        <a
          ref={openRef}
          className="btn btn--ghost-on-blue btn--small pd-done__open"
          href={r.deal_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open deal
          <ExternalIcon />
          <span className="sr-only"> in Pipedrive (opens in a new tab)</span>
        </a>
      </div>
      {r.warning && (
        <div className="warning pd-warning" role="note">
          <div className="warning__inner">
            <svg viewBox="0 0 20 20" aria-hidden="true" className="warning__icon">
              <path d="M10 2.5 18.2 17H1.8Z" />
              <path d="M10 8v4M10 14.4v.1" />
            </svg>
            <span>{r.warning}</span>
          </div>
        </div>
      )}
      <button type="button" className="btn btn--copy btn--copy-primary pd-btn" onClick={onStartNext}>
        <svg viewBox="0 0 16 16" aria-hidden="true" className="btn__icon">
          <circle cx="6.5" cy="5.5" r="2.6" />
          <path d="M1.8 13.5a4.8 4.8 0 0 1 9.4 0M12.5 5.5v4M10.5 7.5h4" />
        </svg>
        Start next customer
      </button>
    </div>
  );
}

function Failure({
  kind,
  message,
  retryRef,
  onRetry,
}: {
  kind: "pipedrive" | "offline" | "server" | "not-set-up";
  message: string;
  retryRef: RefObject<HTMLButtonElement | null>;
  onRetry: () => void;
}) {
  const text =
    kind === "pipedrive" ? (
      <>
        <strong>Not sent to Pipedrive.</strong> {message}
      </>
    ) : kind === "server" ? (
      <>
        <strong>The send didn't finish.</strong> Check Pipedrive for a new deal before you try again.
      </>
    ) : kind === "not-set-up" ? (
      <>
        <strong>Sending to Pipedrive isn't set up.</strong> Copy the basket for records instead.
      </>
    ) : (
      <>
        <strong>Can't reach the server.</strong> Check the connection, then try again.
      </>
    );
  return (
    <div className="notice notice--offline pd-fail" role="alert">
      <p>{text}</p>
      {kind !== "not-set-up" && (
        <button ref={retryRef} type="button" className="btn btn--on-blue btn--small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
