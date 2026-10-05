// The basket: a list of quote request bodies, saved in localStorage and re-priced through the API.
// No pricing happens here: totals, groups and the records text all come from POST /api/basket.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { postBasket } from "./api";
import type { BasketGroup, BasketItemResult, QuoteRequest, QuoteResponse } from "./types";

export const BASKET_KEY = "abacus.basket.v1";
export const BASKET_MAX = 50;

export interface BasketItem {
  id: string;
  request: QuoteRequest;
  /** The quote shown in the panel when the item was added or updated, used until the basket is re-priced. */
  provisional?: QuoteResponse;
}

/** What the drawer shows for one item. */
export interface PricedItem {
  item: BasketItem;
  /** null while the item has never been priced (only possible without a provisional quote). */
  result: Pick<BasketItemResult, "ok" | "quote" | "errors"> | null;
}

let seq = 0;
const newId = () => `item-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function isRequest(x: unknown): x is QuoteRequest {
  if (!x || typeof x !== "object") return false;
  const r = x as { quote_type?: unknown; property?: unknown };
  return (r.quote_type === "windows" || r.quote_type === "gutters") && !!r.property && typeof r.property === "object";
}

function load(): BasketItem[] {
  try {
    const raw = window.localStorage.getItem(BASKET_KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter(isRequest)
      .slice(0, BASKET_MAX)
      .map((request) => ({ id: newId(), request }));
  } catch {
    return [];
  }
}

function save(items: BasketItem[]) {
  try {
    if (items.length === 0) window.localStorage.removeItem(BASKET_KEY);
    else window.localStorage.setItem(BASKET_KEY, JSON.stringify(items.map((i) => i.request)));
  } catch {
    /* Storage blocked or full: the basket still works for this visit. */
  }
}

interface Priced {
  requests: QuoteRequest[];
  items: BasketItemResult[];
  groups: BasketGroup[];
  summary: string;
}

export function useBasket(delay = 250) {
  const [items, setItems] = useState<BasketItem[]>(load);
  const [priced, setPriced] = useState<Priced | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ctrlRef = useRef<AbortController | null>(null);
  const firstRun = useRef(true);

  useEffect(() => save(items), [items]);

  const requests = useMemo(() => items.map((i) => i.request), [items]);

  useEffect(() => {
    ctrlRef.current?.abort();
    if (requests.length === 0) {
      setPriced({ requests, items: [], groups: [], summary: "" });
      setLoading(false);
      setFailed(false);
      return;
    }
    setLoading(true);
    const wait = firstRun.current ? 0 : delay;
    firstRun.current = false;
    const timer = window.setTimeout(() => {
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      postBasket(requests, ctrl.signal)
        .then((res) => {
          if (ctrl.signal.aborted) return;
          setPriced({ requests, items: res.items, groups: res.groups, summary: res.summary_text });
          setFailed(false);
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted || (e as Error).name === "AbortError") return;
          setFailed(true);
          setLoading(false);
        });
    }, wait);
    return () => window.clearTimeout(timer);
  }, [requests, delay, attempt]);

  useEffect(() => () => ctrlRef.current?.abort(), []);

  /** Each item with its latest price: from the last basket response if it priced this exact request. */
  const pricedItems: PricedItem[] = useMemo(() => {
    const byRequest = new Map<QuoteRequest, BasketItemResult>();
    priced?.requests.forEach((r, i) => {
      const res = priced.items[i];
      if (res) byRequest.set(r, res);
    });
    return items.map((item) => {
      const res = byRequest.get(item.request);
      if (res) return { item, result: res };
      if (item.provisional) return { item, result: { ok: true, quote: item.provisional, errors: [] } };
      return { item, result: null };
    });
  }, [items, priced]);

  /** True when the groups and records text describe exactly the current basket. */
  const current =
    !!priced &&
    priced.requests.length === requests.length &&
    priced.requests.every((r, i) => r === requests[i]);

  const add = useCallback((request: QuoteRequest, quote: QuoteResponse) => {
    setItems((list) => (list.length >= BASKET_MAX ? list : [...list, { id: newId(), request, provisional: quote }]));
  }, []);

  const update = useCallback((id: string, request: QuoteRequest, quote: QuoteResponse) => {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, request, provisional: quote } : i)));
  }, []);

  const remove = useCallback((id: string) => {
    setItems((list) => list.filter((i) => i.id !== id));
  }, []);

  const restore = useCallback((item: BasketItem, index: number) => {
    setItems((list) => {
      if (list.some((i) => i.id === item.id) || list.length >= BASKET_MAX) return list;
      const next = [...list];
      next.splice(Math.min(index, next.length), 0, item);
      return next;
    });
  }, []);

  const clear = useCallback(() => setItems([]), []);

  return {
    items,
    pricedItems,
    groups: priced?.groups ?? [],
    summary: current ? (priced?.summary ?? "") : "",
    /** Groups exist but describe an older version of the basket (still pricing, or the last call failed). */
    stale: !current,
    hasPriced: !!priced,
    loading,
    failed,
    retry: useCallback(() => setAttempt((n) => n + 1), []),
    add,
    update,
    remove,
    restore,
    clear,
  };
}

export type Basket = ReturnType<typeof useBasket>;
