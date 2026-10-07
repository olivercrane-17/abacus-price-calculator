import type { AddressLookup, BasketResponse, Config, FieldError, QuoteRequest, QuoteResponse } from "./types";

export class ValidationError extends Error {
  constructor(public errors: FieldError[]) {
    super("Validation failed");
  }
}

export class UnreachableError extends Error {}

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
