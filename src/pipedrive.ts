// Send to Pipedrive: the pure checks (what's still missing, has this exact basket been sent already) and the
// hook that talks to /api/session, /api/unlock, /api/lock and /api/pipedrive/send.
// The server re-checks and re-prices everything; these checks only decide what the button shows.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchSession,
  lock as apiLock,
  LockedError,
  NotSetUpError,
  PipedriveError,
  sendToPipedrive,
  unlock as apiUnlock,
  UnreachableError,
  ValidationError,
} from "./api";
import type { PricedItem } from "./basket";
import type { Customer } from "./customer";
import type { FieldError, PipedriveSendResult, QuoteRequest } from "./types";

/** The last successful send, kept for this tab (sessionStorage) so a refresh can't send it twice. */
export const SENT_KEY = "abacus.pipedrive.sent.v1";

/* ---------- Can it be sent? (mirrors require_contact and the basket checks in integrations/) ---------- */

export type CustomerField = "name" | "phone";

export interface SendCheck {
  ok: boolean;
  /** Why it can't be sent yet, as one sentence. "" when it can. */
  reason: string;
  /** The first customer field to fill in, for the "Add details" link. */
  field: CustomerField | null;
}

export interface BasketState {
  items: PricedItem[];
  /** The prices describe an older version of the basket (still pricing, or the last call failed). */
  stale: boolean;
  failed: boolean;
}

function listOf(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * What's stopping a send: at least one job, every job priced (none needing attention, prices up to date),
 * the customer's name, and a phone number or email.
 */
export function sendCheck(basket: BasketState, customer: Pick<Customer, "name" | "phone" | "email">): SendCheck {
  const noName = customer.name.trim() === "";
  const noContact = customer.phone.trim() === "" && customer.email.trim() === "";
  const missing = [...(noName ? ["the customer's name"] : []), ...(noContact ? ["a phone number or email"] : [])];
  const field: CustomerField | null = noName ? "name" : noContact ? "phone" : null;

  const { items } = basket;
  const attention = items.some((p) => p.result && !p.result.ok);
  const unpriced = basket.stale || items.some((p) => !p.result);

  let reason = "";
  if (items.length === 0) reason = `Add ${listOf(["a job", ...missing])} to send.`;
  else if (attention)
    reason = `Fix the jobs marked Needs attention${missing.length ? `, and add ${listOf(missing)},` : ""} to send.`;
  else if (missing.length) reason = `Add ${listOf(missing)} to send.`;
  else if (unpriced)
    reason = basket.failed ? "The prices need updating before you can send. Try again above." : "Updating the prices…";
  return { ok: reason === "", reason, field };
}

export const canSend = (basket: BasketState, customer: Pick<Customer, "name" | "phone" | "email">): boolean =>
  sendCheck(basket, customer).ok;

/** Which customer field a server error (422) belongs to, if any. */
export function customerErrorField(field: string): CustomerField | null {
  if (field === "customer.name") return "name";
  if (field === "customer.phone" || field === "customer.email") return "phone";
  return null;
}

/* ---------- "Already sent" fingerprint ---------- */

/** The customer fields the server reads, trimmed, so whitespace or the town's "filled in" flag don't count. */
const CUSTOMER_FIELDS = [
  "name",
  "line1",
  "line2",
  "town",
  "county",
  "postcode",
  "phone",
  "email",
  "heardVia",
  "heardOther",
  "contactMethod",
  "notes",
] as const satisfies readonly (keyof Customer)[];

/** JSON with object keys sorted, so the same content always gives the same text. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** cyrb53: a fast 53-bit string hash (not for security: it only tells baskets apart). */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * A short fingerprint of exactly what would be sent: the basket's quote requests plus the customer.
 * Only a hash is kept, so no customer details are stored for it.
 */
export function sendFingerprint(items: QuoteRequest[], customer: Customer): string {
  const c: Record<string, string> = {};
  for (const k of CUSTOMER_FIELDS) c[k] = String(customer[k] ?? "").trim();
  if (c.heardVia !== "other") c.heardOther = "";
  return hash53(stableStringify({ items, customer: c }));
}

/* ---------- The hook ---------- */

export type Session = "checking" | "locked" | "unlocked";

export type FailureKind = "pipedrive" | "offline" | "server" | "not-set-up";

export type SendState =
  | { status: "idle" }
  | { status: "sending"; fingerprint: string }
  | { status: "failed"; fingerprint: string; kind: FailureKind; message: string }
  | { status: "invalid"; fingerprint: string; errors: FieldError[] };

export interface SentRecord {
  fingerprint: string;
  result: PipedriveSendResult;
}

/** Something that just happened, for the send area to announce and move focus on (once). */
export interface PipedriveEvent {
  id: number;
  /** "expired": a send came back 401 (the cookie expired or the passcode changed), so it's locked again. */
  type: "unlocked" | "sent" | "failed" | "invalid" | "forgotten" | "expired";
}

export type UnlockResult = { ok: true } | { ok: false; kind: "wrong" | "offline" | "not-set-up"; message: string };

function loadSent(): SentRecord | null {
  try {
    const raw = window.sessionStorage.getItem(SENT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<SentRecord> | null;
    const r = d?.result;
    if (typeof d?.fingerprint !== "string" || !r || typeof r.deal_url !== "string") return null;
    return { fingerprint: d.fingerprint, result: r };
  } catch {
    return null;
  }
}

function saveSent(rec: SentRecord | null) {
  try {
    if (rec) window.sessionStorage.setItem(SENT_KEY, JSON.stringify(rec));
    else window.sessionStorage.removeItem(SENT_KEY);
  } catch {
    /* Storage blocked: the lock still holds until the page is closed. */
  }
}

export function usePipedrive(enabled: boolean) {
  const [session, setSession] = useState<Session>(enabled ? "checking" : "locked");
  const [send, setSend] = useState<SendState>({ status: "idle" });
  const [sent, setSent] = useState<SentRecord | null>(loadSent);
  const [event, setEvent] = useState<PipedriveEvent | null>(null);
  const inFlight = useRef(false);
  const eventId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const emit = useCallback((type: PipedriveEvent["type"]) => {
    eventId.current += 1;
    setEvent({ id: eventId.current, type });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    setSession("checking");
    fetchSession(ctrl.signal)
      .then((unlocked) => setSession(unlocked ? "unlocked" : "locked"))
      .catch((e: unknown) => {
        // Can't tell: show it locked. Unlocking will report the connection problem.
        if ((e as Error).name !== "AbortError") setSession("locked");
      });
    return () => ctrl.abort();
  }, [enabled]);

  const unlock = useCallback(
    async (passcode: string): Promise<UnlockResult> => {
      try {
        await apiUnlock(passcode);
      } catch (e) {
        if (e instanceof LockedError || e instanceof ValidationError)
          return { ok: false, kind: "wrong", message: e.errors[0]?.message || "That passcode isn't right" };
        if (e instanceof NotSetUpError)
          return { ok: false, kind: "not-set-up", message: "Sending to Pipedrive isn't set up on the server." };
        return { ok: false, kind: "offline", message: "Can't reach the server. Check the connection, then try again." };
      }
      setSession("unlocked");
      emit("unlocked");
      return { ok: true };
    },
    [emit],
  );

  /** "Forget this device". False when the server couldn't be reached (the device is still unlocked). */
  const forget = useCallback(async (): Promise<boolean> => {
    try {
      await apiLock();
    } catch {
      return false;
    }
    setSession("locked");
    setSend((s) => (s.status === "sending" ? s : { status: "idle" }));
    emit("forgotten");
    return true;
  }, [emit]);

  const sendNow = useCallback(
    async (items: QuoteRequest[], customer: Customer) => {
      if (inFlight.current) return; // no double submits
      inFlight.current = true;
      const fingerprint = sendFingerprint(items, customer);
      setSend({ status: "sending", fingerprint });
      try {
        const result = await sendToPipedrive(items, customer);
        const rec = { fingerprint, result };
        saveSent(rec);
        if (!mounted.current) return;
        setSent(rec);
        setSend({ status: "idle" });
        emit("sent");
      } catch (e) {
        if (!mounted.current) return;
        if (e instanceof LockedError) {
          setSession("locked");
          setSend({ status: "idle" });
          emit("expired");
        } else if (e instanceof ValidationError) {
          setSend({ status: "invalid", fingerprint, errors: e.errors });
          emit("invalid");
        } else {
          let kind: FailureKind = "offline";
          let message = "";
          if (e instanceof PipedriveError) {
            kind = "pipedrive";
            message = e.message;
          } else if (e instanceof NotSetUpError) kind = "not-set-up";
          else if (e instanceof UnreachableError && e.status !== undefined) kind = "server";
          setSend({ status: "failed", fingerprint, kind, message });
          emit("failed");
        }
      } finally {
        inFlight.current = false;
      }
    },
    [emit],
  );

  /** Forget the last send (after the basket and customer are cleared). */
  const reset = useCallback(() => {
    saveSent(null);
    setSent(null);
    setSend((s) => (s.status === "sending" ? s : { status: "idle" }));
  }, []);

  return { enabled, session, state: send, sent, event, unlock, forget, send: sendNow, reset };
}

export type PipedriveStore = ReturnType<typeof usePipedrive>;
