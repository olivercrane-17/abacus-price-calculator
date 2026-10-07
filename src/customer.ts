// Customer contact details for the basket record.
// Kept only in this browser tab (sessionStorage) and in the copied text: nothing here is sent to our server,
// apart from the postcode for the lookup.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lookupAddress, ValidationError } from "./api";
import type { AddressLookup } from "./types";

export const CUSTOMER_KEY = "abacus.customer.v1";

export const HEARD_VIA = [
  { value: "google", label: "Google / web search" },
  { value: "facebook", label: "Facebook / social media" },
  { value: "recommendation", label: "Recommendation" },
  { value: "seen", label: "Saw us working / van / flyer" },
  { value: "other", label: "Other" },
] as const;

export const CONTACT_METHODS = [
  { value: "call", label: "Phone call" },
  { value: "text", label: "Text message" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
] as const;

export type HeardVia = (typeof HEARD_VIA)[number]["value"];
export type ContactMethod = (typeof CONTACT_METHODS)[number]["value"];

export interface Customer {
  name: string;
  line1: string;
  line2: string;
  town: string;
  /** Filled from the postcode lookup only (shown read-only). */
  county: string;
  postcode: string;
  phone: string;
  email: string;
  heardVia: HeardVia | "";
  heardOther: string;
  contactMethod: ContactMethod | "";
  notes: string;
  /** True while `town` holds the value the lookup filled in (staff haven't typed over it). */
  townAuto: boolean;
}

export const emptyCustomer = (): Customer => ({
  name: "",
  line1: "",
  line2: "",
  town: "",
  county: "",
  postcode: "",
  phone: "",
  email: "",
  heardVia: "",
  heardOther: "",
  contactMethod: "",
  notes: "",
  townAuto: false,
});

const TEXT_FIELDS = [
  "name",
  "line1",
  "line2",
  "town",
  "county",
  "postcode",
  "phone",
  "email",
  "heardOther",
  "notes",
] as const satisfies readonly (keyof Customer)[];

export function customerIsEmpty(c: Customer): boolean {
  // The "Other" text only counts while Other is the chosen option.
  return TEXT_FIELDS.every((k) => k === "heardOther" || c[k].trim() === "") && !c.heardVia && !c.contactMethod;
}

/* ---------- Persistence (sessionStorage: survives a refresh, gone when the tab closes) ---------- */

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");

function load(): Customer {
  try {
    const raw = window.sessionStorage.getItem(CUSTOMER_KEY);
    if (!raw) return emptyCustomer();
    const d: unknown = JSON.parse(raw);
    if (!d || typeof d !== "object") return emptyCustomer();
    const o = d as Record<string, unknown>;
    const c = emptyCustomer();
    for (const k of TEXT_FIELDS) c[k] = str(o[k]);
    c.heardVia = HEARD_VIA.find((h) => h.value === o.heardVia)?.value ?? "";
    c.contactMethod = CONTACT_METHODS.find((m) => m.value === o.contactMethod)?.value ?? "";
    c.townAuto = o.townAuto === true;
    return c;
  } catch {
    return emptyCustomer();
  }
}

function save(c: Customer) {
  try {
    if (customerIsEmpty(c)) window.sessionStorage.removeItem(CUSTOMER_KEY);
    else window.sessionStorage.setItem(CUSTOMER_KEY, JSON.stringify(c));
  } catch {
    /* Storage blocked or full: the details still work until the page is closed. */
  }
}

export function useCustomer() {
  const [customer, setCustomer] = useState<Customer>(load);
  useEffect(() => save(customer), [customer]);
  const set = useCallback((patch: Partial<Customer>) => setCustomer((c) => ({ ...c, ...patch })), []);
  const clear = useCallback(() => setCustomer(emptyCustomer()), []);
  const isEmpty = useMemo(() => customerIsEmpty(customer), [customer]);
  return { customer, set, clear, isEmpty };
}

export type CustomerStore = ReturnType<typeof useCustomer>;

/* ---------- Name ---------- */

/** Capitalise the first letter of each word as it's typed ("jane smith-jones" → "Jane Smith-Jones", "o'brien" → "O'Brien"). */
export function capitaliseWords(text: string): string {
  return text
    .replace(/(^|[\s-])([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase())
    .replace(
      /(^|[\s-])([A-Za-z]')([a-z])/g,
      (_m, pre: string, o: string, ch: string) => pre + o.toUpperCase() + ch.toUpperCase(),
    );
}

/** The first word of the name, for the basket badge. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/* ---------- Postcode ---------- */

const FULL_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;

/** True when the text is a complete UK postcode (with or without the space). */
export function isFullPostcode(text: string): boolean {
  const compact = text.toUpperCase().replace(/\s+/g, "");
  return compact === "GIR0AA" || FULL_POSTCODE.test(compact);
}

/** Uppercase as it's typed, and put the space in once the whole postcode is there ("gu98ab" → "GU9 8AB"). */
export function formatPostcodeAsTyped(text: string): string {
  const upper = text
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^ /, "");
  const compact = upper.replace(/ /g, "");
  if (isFullPostcode(compact)) return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  return upper.slice(0, 8);
}

/* ---------- Phone ---------- */

/** Group UK national digits (with the leading 0) the way they're usually written. */
function groupNational(n: string): string {
  if (/^02/.test(n)) return `${n.slice(0, 3)} ${n.slice(3, 7)} ${n.slice(7)}`; // 020 7946 0018
  if (/^01\d1/.test(n) || /^011/.test(n) || /^0[3589]/.test(n))
    return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`; // 0113 496 0000, 0800 123 4567
  return `${n.slice(0, 5)} ${n.slice(5)}`; // 07920 422778, 01252 834238
}

/** Digits of a UK number as national format (leading 0), or null if it isn't one. */
function ukNational(text: string): { national: string; international: boolean } | null {
  const t = text
    .trim()
    .replace(/\(0\)/g, "")
    .replace(/[\s().-]/g, "");
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(?:\+44|0044)(\d{10})$/))) return { national: `0${m[1]}`, international: true };
  if ((m = t.match(/^(0\d{10})$/))) return { national: m[1], international: false };
  return null;
}

/**
 * Format a UK phone number: "07920422778" → "07920 422778", "+447920422778" → "+44 7920 422778".
 * Anything that doesn't parse as a UK number is returned exactly as typed.
 */
export function formatUkPhone(text: string): string {
  const uk = ukNational(text);
  if (!uk) return text;
  const grouped = groupNational(uk.national);
  return uk.international ? `+44 ${grouped.slice(1)}` : grouped;
}

/** A soft check: blank, or a UK number with the right number of digits (01/02/03/05/07/08/09). */
export function phoneLooksValid(text: string): boolean {
  if (text.trim() === "") return true;
  const uk = ukNational(text);
  return !!uk && /^0[1235789]/.test(uk.national);
}

/* ---------- Email ---------- */

/** Real domains we never "correct". */
const KNOWN_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "live.co.uk",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "btinternet.com",
  "sky.com",
  "talktalk.net",
  "virginmedia.com",
  "ntlworld.com",
  "mail.com",
  "gmx.com",
  "gmx.co.uk",
  "protonmail.com",
  "proton.me",
];

const DOMAIN_FIXES: Record<string, string> = {
  "yahoo.co": "yahoo.co.uk",
  "hotmail.co": "hotmail.co.uk",
  "gmail.co": "gmail.com",
  "gmail.co.uk": "gmail.com",
  "gmai.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gmil.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gnail.com": "gmail.com",
  "outlok.com": "outlook.com",
  "outloo.com": "outlook.com",
  "aol.co": "aol.com",
  "iclod.com": "icloud.com",
};

/** Optimal string alignment distance (Levenshtein plus swapping two neighbouring letters). */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** "jane@gmial.com" → "jane@gmail.com". Null when the domain looks fine (or there's no domain yet). */
export function emailTypoSuggestion(email: string): string | null {
  const t = email.trim();
  const at = t.lastIndexOf("@");
  if (at < 1) return null;
  const local = t.slice(0, at);
  const domain = t.slice(at + 1).toLowerCase();
  if (!domain.includes(".") || KNOWN_DOMAINS.includes(domain)) return null;

  let fixed: string | null = DOMAIN_FIXES[domain] ?? null;
  if (!fixed) {
    // Common slips in the ending: .con, .cmo, .co,uk ...
    const tld = domain
      .replace(/\.(con|cmo|cm|om|comm|vom|xom)$/, ".com")
      .replace(/\.co\.(k|u|ukk)$/, ".co.uk")
      .replace(/,/g, ".");
    if (tld !== domain) fixed = DOMAIN_FIXES[tld] ?? tld;
  }
  if (!fixed && domain.length >= 7) {
    // One letter out (or two swapped) from a well-known domain.
    const near = KNOWN_DOMAINS.filter((k) => k.length >= 7 && editDistance(domain, k) === 1);
    if (near.length === 1) fixed = near[0];
  }
  if (!fixed || fixed === domain) return null;
  return `${local}@${fixed}`;
}

/* ---------- The copied record ---------- */

const RULE = "-".repeat(40);

export function heardViaText(c: Pick<Customer, "heardVia" | "heardOther">): string {
  if (!c.heardVia) return "";
  if (c.heardVia === "other") return c.heardOther.trim() ? `Other (${c.heardOther.trim()})` : "Other";
  return HEARD_VIA.find((h) => h.value === c.heardVia)?.label ?? "";
}

export function addressText(c: Customer): string {
  return [c.line1, c.line2, c.town, c.county, c.postcode]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(", ");
}

/** The plain-text CUSTOMER block for the records copy: only the filled-in fields. "" when there's nothing. */
export function customerBlock(c: Customer): string {
  if (customerIsEmpty(c)) return "";
  const notes = c.notes
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join("; ");
  const rows: [string, string][] = [
    ["Name", c.name.trim()],
    ["Address", addressText(c)],
    ["Phone", c.phone.trim()],
    ["Email", c.email.trim()],
    ["Prefers", CONTACT_METHODS.find((m) => m.value === c.contactMethod)?.label ?? ""],
    ["Heard via", heardViaText(c)],
    ["Notes", notes],
  ];
  const lines = rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  if (lines.length === 0) return "";
  return ["CUSTOMER", ...lines, RULE].join("\n");
}

/** What "Copy basket for records" copies. Null when there's nothing to copy yet. */
export function basketRecord(c: Customer, summary: string | null, hasJobs: boolean): string | null {
  const block = customerBlock(c);
  if (!block) return summary || null;
  if (!hasJobs) return `${block}\n\nNo jobs in basket`;
  // Jobs are still being priced: wait for the summary rather than copy half a record.
  if (!summary) return null;
  return `${block}\n\n${summary}`;
}

/** One-line summary for the collapsed section: "Jane Smith · GU9 8AB · 07920 422778". */
export function customerSummary(c: Customer): string {
  return [c.name, c.postcode, c.phone || c.email]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" · ");
}

/* ---------- Postcode lookup hook ---------- */

export type LookupState =
  | { status: "idle" }
  | { status: "loading"; postcode: string }
  | { status: "found"; result: AddressLookup }
  | { status: "unknown"; postcode: string }
  | { status: "offline"; postcode: string }
  | { status: "invalid"; message: string };

/** Results per postcode for this session (only definite answers: a failed lookup is tried again). */
const cache = new Map<string, AddressLookup>();

/**
 * Look the postcode up once it's complete: debounced, stale requests aborted, cached per postcode.
 * `onResult` runs for each definite result (fresh or cached), so the caller can fill in the town.
 */
export function usePostcodeLookup(postcode: string, onResult: (r: AddressLookup) => void, delay = 300): LookupState {
  const [state, setState] = useState<LookupState>({ status: "idle" });
  const cb = useRef(onResult);
  cb.current = onResult;
  const key = isFullPostcode(postcode) ? formatPostcodeAsTyped(postcode) : "";

  useEffect(() => {
    if (!key) {
      setState({ status: "idle" });
      return;
    }
    const hit = cache.get(key);
    if (hit) {
      setState(hit.valid ? { status: "found", result: hit } : { status: "unknown", postcode: key });
      cb.current(hit);
      return;
    }
    setState({ status: "loading", postcode: key });
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      lookupAddress(key, ctrl.signal)
        .then((r) => {
          if (ctrl.signal.aborted) return;
          if (r.valid === null) {
            setState({ status: "offline", postcode: key });
            return;
          }
          cache.set(key, r);
          setState(r.valid ? { status: "found", result: r } : { status: "unknown", postcode: key });
          cb.current(r);
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted || (e as Error).name === "AbortError") return;
          if (e instanceof ValidationError) setState({ status: "invalid", message: e.errors[0]?.message ?? "" });
          else setState({ status: "offline", postcode: key });
        });
    }, delay);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [key, delay]);

  return state;
}
