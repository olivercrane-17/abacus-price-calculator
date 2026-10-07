import type { Customer } from "./customer";
import type {
  AddressLookup,
  BasketResponse,
  Config,
  FieldError,
  PipedriveSendResult,
  QuoteRequest,
  QuoteResponse,
  SessionResponse,
} from "./types";

export class ValidationError extends Error {
  constructor(public errors: FieldError[]) {
    super("Validation failed");
  }
}

export class UnreachableError extends Error {
  /** The HTTP status when the server answered with an unexpected error; undefined when it couldn't be reached. */
  constructor(
    message?: string,
    public status?: number,
  ) {
    super(message);
  }
}

/** 401 from a staff route: wrong passcode, or this device isn't unlocked (cookie missing or expired). */
export class LockedError extends Error {
  constructor(public errors: FieldError[]) {
    super("Locked");
  }
}

/** 404 from a Pipedrive route: sending isn't set up on the server. */
export class NotSetUpError extends Error {}

/** 502: Pipedrive refused or didn't answer. The message is written for staff. */
export class PipedriveError extends Error {}

export async function fetchConfig(signal?: AbortSignal): Promise<Config> {
  let res: Response;
  try {
    res = await fetch("/api/config", { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new UnreachableError("Network error");
  }
  if (!res.ok) throw new UnreachableError(`HTTP ${res.status}`);
  return (await res.json()) as Config;
}

async function readErrors(res: Response): Promise<FieldError[]> {
  let errors: FieldError[] = [];
  try {
    const data = await res.json();
    if (Array.isArray(data?.errors)) {
      errors = data.errors;
    } else if (Array.isArray(data?.detail)) {
      // FastAPI's default request-validation shape, just in case.
      errors = data.detail.map((d: { loc?: (string | number)[]; msg?: string }) => ({
        field: (d.loc ?? []).filter((p) => p !== "body").join("."),
        message: d.msg ?? "Check this value",
      }));
    }
  } catch {
    /* fall through */
  }
  return errors.length ? errors : [{ field: "", message: "Check the options entered." }];
}

async function post<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new UnreachableError("Network error");
  }
  if (res.status === 422) throw new ValidationError(await readErrors(res));
  if (!res.ok) throw new UnreachableError(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function postQuote(body: QuoteRequest, signal: AbortSignal): Promise<QuoteResponse> {
  return post<QuoteResponse>("/api/quote", body, signal);
}

/** Price a whole basket. Invalid items come back with ok:false; a malformed body is a 422. */
export function postBasket(items: QuoteRequest[], signal: AbortSignal): Promise<BasketResponse> {
  return post<BasketResponse>("/api/basket", { items }, signal);
}

/**
 * Look up a UK postcode (town and county; full addresses when a paid provider is set up).
 * A malformed postcode is a ValidationError; a failed request is an UnreachableError.
 */
export async function lookupAddress(postcode: string, signal?: AbortSignal): Promise<AddressLookup> {
  let res: Response;
  try {
    res = await fetch(`/api/address?postcode=${encodeURIComponent(postcode)}`, { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new UnreachableError("Network error");
  }
  if (res.status === 422) throw new ValidationError(await readErrors(res));
  if (!res.ok) throw new UnreachableError(`HTTP ${res.status}`);
  return (await res.json()) as AddressLookup;
}

/* ---------- Pipedrive (behind the staff passcode cookie) ---------- */

/** POST to a staff route, sending the passcode cookie, and map each failure to its own error class. */
async function staffPost<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new UnreachableError("Network error");
  }
  if (res.ok) return (await res.json()) as T;
  if (res.status === 401) throw new LockedError(await readErrors(res));
  if (res.status === 404) throw new NotSetUpError(`HTTP ${res.status}`);
  if (res.status === 422) throw new ValidationError(await readErrors(res));
  if (res.status === 502) {
    const errors = await readErrors(res);
    const named = errors.find((e) => e.field === "pipedrive");
    throw new PipedriveError(named?.message ?? "Pipedrive didn't respond. Try again.");
  }
  throw new UnreachableError(`HTTP ${res.status}`, res.status);
}

/** Is this device unlocked for sending? (The cookie is HttpOnly, so ask the server.) */
export async function fetchSession(signal?: AbortSignal): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch("/api/session", { credentials: "same-origin", signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new UnreachableError("Network error");
  }
  if (!res.ok) throw new UnreachableError(`HTTP ${res.status}`, res.status);
  return ((await res.json()) as SessionResponse).unlocked === true;
}

/** Unlock sending on this device. A wrong passcode is a LockedError (the server waits ~1s first). */
export async function unlock(passcode: string): Promise<void> {
  await staffPost<{ ok: boolean }>("/api/unlock", { passcode });
}

/** "Forget this device": the server clears the passcode cookie. */
export async function lock(): Promise<void> {
  await staffPost<{ ok: boolean }>("/api/lock", {});
}

/** Create (or reuse) the Person, then a Deal and Note. The server re-prices the items itself. */
export function sendToPipedrive(
  items: QuoteRequest[],
  customer: Customer,
  signal?: AbortSignal,
): Promise<PipedriveSendResult> {
  return staffPost<PipedriveSendResult>("/api/pipedrive/send", { items, customer }, signal);
}
