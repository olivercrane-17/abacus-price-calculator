import type { Config, FieldError, QuoteRequest, QuoteResponse } from "./types";

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

export async function postQuote(body: QuoteRequest, signal: AbortSignal): Promise<QuoteResponse> {
  let res: Response;
  try {
    res = await fetch("/api/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new UnreachableError("Network error");
  }
  if (res.status === 422) {
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
    throw new ValidationError(errors.length ? errors : [{ field: "", message: "Check the options entered." }]);
  }
  if (!res.ok) throw new UnreachableError(`HTTP ${res.status}`);
  return (await res.json()) as QuoteResponse;
}
