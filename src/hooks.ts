import { useCallback, useEffect, useRef, useState } from "react";
import { fetchConfig, postQuote, UnreachableError, ValidationError } from "./api";
import type { Config, FieldError, QuoteRequest, QuoteResponse } from "./types";

type ConfigState = { status: "loading" } | { status: "error" } | { status: "ready"; config: Config };

export function useConfig() {
  const [state, setState] = useState<ConfigState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ status: "loading" });
    fetchConfig(ctrl.signal)
      .then((config) => setState({ status: "ready", config }))
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setState({ status: "error" });
      });
    return () => ctrl.abort();
  }, [attempt]);

  return { state, retry: useCallback(() => setAttempt((n) => n + 1), []) };
}

export interface QuoteState {
  /** Last successful response for the current tab (kept while loading or after a network failure). */
  result: QuoteResponse | null;
  /** The exact request that produced `result`. */
  resultFor: QuoteRequest | null;
  /** 422 errors for the latest request. */
  errors: FieldError[];
  loading: boolean;
  unreachable: boolean;
  retry: () => void;
}

/**
 * Live quote: debounced 120ms, stale requests aborted, last good result kept.
 * `request` must be memoised by the caller so it only changes when inputs change.
 */
export function useQuote(request: QuoteRequest | null, delay = 120): QuoteState {
  const [priced, setPriced] = useState<{ result: QuoteResponse; request: QuoteRequest } | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [loading, setLoading] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ctrlRef = useRef<AbortController | null>(null);
  const firstRun = useRef(true);

  useEffect(() => {
    if (!request) return;
    setLoading(true);
    // Fire the very first request at once; debounce everything after.
    const wait = firstRun.current ? 0 : delay;
    firstRun.current = false;
    const timer = window.setTimeout(() => {
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      postQuote(request, ctrl.signal)
        .then((res) => {
          if (ctrl.signal.aborted) return;
          setPriced({ result: res, request });
          setErrors([]);
          setUnreachable(false);
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted || (e as Error).name === "AbortError") return;
          if (e instanceof ValidationError) {
            setErrors(e.errors);
            setUnreachable(false);
          } else if (e instanceof UnreachableError || e instanceof Error) {
            setUnreachable(true);
          }
          setLoading(false);
        });
    }, wait);
    return () => window.clearTimeout(timer);
  }, [request, delay, attempt]);

  useEffect(() => () => ctrlRef.current?.abort(), []);

  return {
    result: priced?.result ?? null,
    resultFor: priced?.request ?? null,
    errors,
    loading,
    unreachable,
    retry: useCallback(() => setAttempt((n) => n + 1), []),
  };
}

export function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return;
    const on = () => setReduced(mql.matches);
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const on = () => setMatch(mql.matches);
    on();
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** Animate a number toward `target` (count up/down). Instant when reduced motion is on. */
export function useCountUp(target: number, duration = 520): number {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);

  useEffect(() => {
    if (reduced) {
      valueRef.current = target;
      setValue(target);
      return;
    }
    const from = valueRef.current;
    if (from === target) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(from + (target - from) * eased);
      valueRef.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduced]);

  return value;
}
