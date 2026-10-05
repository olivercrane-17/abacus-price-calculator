// Form state for each tab, and the mapping from form state to the API request.
// No pricing happens here: values are passed through as entered.

import { parsePounds } from "./format";
import type {
  ConservatoryChoice,
  FieldError,
  GutterService,
  GuttersRequest,
  LanternSize,
  OverrideRequest,
  PropertyRequest,
  WindowsFrequency,
  WindowsRequest,
} from "./types";

export type PropertyChoice = "1" | "2" | "3" | "4" | "5" | "other";

export interface OverrideState {
  open: boolean;
  total: string;
  reason: string;
}

export interface WindowsState {
  property: PropertyChoice;
  otherDescription: string;
  otherPrice: string;
  frequency: WindowsFrequency;
  conservatory: ConservatoryChoice;
  largeConservatoryPrice: string;
  internal: boolean;
  roof: { external: number; internal: number };
  velux: { external: number; internal: number };
  lanterns: Record<LanternSize, { external: number; internal: number }>;
  largerLantern: boolean;
  largerLanternPrice: string;
  override: OverrideState;
}

export interface GuttersState {
  property: PropertyChoice;
  otherDescription: string;
  service: GutterService;
  conservatory: boolean;
  heavilySoiled: boolean;
  manualPrice: string;
  extras: { name: string; selected: boolean; price: string }[];
  override: OverrideState;
}

const emptyOverride: OverrideState = { open: false, total: "", reason: "" };

export function initialWindows(): WindowsState {
  return {
    property: "3",
    otherDescription: "",
    otherPrice: "",
    frequency: "4",
    conservatory: "none",
    largeConservatoryPrice: "",
    internal: false,
    roof: { external: 0, internal: 0 },
    velux: { external: 0, internal: 0 },
    lanterns: {
      small: { external: 0, internal: 0 },
      medium: { external: 0, internal: 0 },
      large: { external: 0, internal: 0 },
    },
    largerLantern: false,
    largerLanternPrice: "",
    override: { ...emptyOverride },
  };
}

export function initialGutters(askAbout: string[]): GuttersState {
  return {
    property: "3",
    otherDescription: "",
    service: "package3",
    conservatory: false,
    heavilySoiled: false,
    manualPrice: "",
    extras: askAbout.map((name) => ({ name, selected: false, price: "" })),
    override: { ...emptyOverride },
  };
}

const pounds = (text: string) => parsePounds(text).value;

function overrideRequest(o: OverrideState): OverrideRequest | null {
  if (!o.open) return null;
  const total = pounds(o.total);
  if (total === null && o.reason.trim() === "") return null;
  return { total, reason: o.reason.trim() };
}

export function windowsRequest(s: WindowsState): WindowsRequest {
  const isOther = s.property === "other";
  const property: PropertyRequest = isOther
    ? { kind: "other", description: s.otherDescription.trim(), price: pounds(s.otherPrice) }
    : { kind: "standard", bedrooms: Number(s.property) };
  const conservatory = isOther ? "none" : s.conservatory;
  return {
    quote_type: "windows",
    property,
    frequency: s.frequency,
    conservatory,
    large_conservatory_price: conservatory === "large" ? pounds(s.largeConservatoryPrice) : null,
    internal: s.internal,
    conservatory_roof: { external_panels: s.roof.external, internal_panels: s.roof.internal },
    velux: { external: s.velux.external, internal: s.velux.internal },
    lanterns: {
      small: { ...s.lanterns.small },
      medium: { ...s.lanterns.medium },
      large: { ...s.lanterns.large },
      larger_price: s.largerLantern ? pounds(s.largerLanternPrice) : null,
    },
    override: overrideRequest(s.override),
  };
}

export function guttersRequest(s: GuttersState): GuttersRequest {
  const isOther = s.property === "other";
  const staffPriced = isOther || s.property === "1";
  const property: PropertyRequest = isOther
    ? { kind: "other", description: s.otherDescription.trim() }
    : { kind: "standard", bedrooms: Number(s.property) };
  return {
    quote_type: "gutters",
    property,
    service: s.service,
    conservatory: s.conservatory,
    heavily_soiled: staffPriced ? false : s.heavilySoiled,
    manual_price: staffPriced ? pounds(s.manualPrice) : null,
    extras: s.extras.map((x) => ({ name: x.name, selected: x.selected, price: pounds(x.price) })),
    override: overrideRequest(s.override),
  };
}

/* ---------- Request → form state (the inverse, for editing basket items) ---------- */

/** Pounds back to the text a member of staff would have typed. parsePounds() reads it back exactly. */
function poundsText(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function overrideState(o: OverrideRequest | null | undefined): OverrideState {
  if (!o) return { ...emptyOverride };
  return { open: true, total: poundsText(o.total), reason: o.reason ?? "" };
}

function propertyChoice(p: PropertyRequest): PropertyChoice {
  if (p.kind === "other") return "other";
  const n = String(p.bedrooms);
  return (["1", "2", "3", "4", "5"] as const).find((c) => c === n) ?? "3";
}

const count = (n: number | undefined) => (typeof n === "number" && n >= 0 ? n : 0);

/** Load a windows request back into the form. windowsRequest(windowsState(r)) round-trips. */
export function windowsState(r: WindowsRequest): WindowsState {
  const base = initialWindows();
  const isOther = r.property.kind === "other";
  const lanterns = r.lanterns ?? base.lanterns;
  const largerPrice = r.lanterns?.larger_price ?? null;
  return {
    ...base,
    property: propertyChoice(r.property),
    otherDescription: r.property.kind === "other" ? r.property.description : "",
    otherPrice: r.property.kind === "other" ? poundsText(r.property.price) : "",
    frequency: r.frequency ?? base.frequency,
    conservatory: isOther ? "none" : (r.conservatory ?? "none"),
    largeConservatoryPrice: r.conservatory === "large" ? poundsText(r.large_conservatory_price) : "",
    internal: !!r.internal,
    roof: {
      external: count(r.conservatory_roof?.external_panels),
      internal: count(r.conservatory_roof?.internal_panels),
    },
    velux: { external: count(r.velux?.external), internal: count(r.velux?.internal) },
    lanterns: {
      small: { external: count(lanterns.small?.external), internal: count(lanterns.small?.internal) },
      medium: { external: count(lanterns.medium?.external), internal: count(lanterns.medium?.internal) },
      large: { external: count(lanterns.large?.external), internal: count(lanterns.large?.internal) },
    },
    largerLantern: largerPrice !== null,
    largerLanternPrice: poundsText(largerPrice),
    override: overrideState(r.override),
  };
}

/** Load a gutters request back into the form. guttersRequest(guttersState(r)) round-trips. */
export function guttersState(r: GuttersRequest, askAbout: string[]): GuttersState {
  const base = initialGutters(askAbout);
  const choice = propertyChoice(r.property);
  const staffPriced = choice === "other" || choice === "1";
  return {
    ...base,
    property: choice,
    otherDescription: r.property.kind === "other" ? r.property.description : "",
    service: r.service ?? base.service,
    conservatory: !!r.conservatory,
    heavilySoiled: staffPriced ? false : !!r.heavily_soiled,
    manualPrice: staffPriced ? poundsText(r.manual_price) : "",
    extras:
      r.extras && r.extras.length
        ? r.extras.map((x) => ({ name: x.name, selected: !!x.selected, price: poundsText(x.price) }))
        : base.extras,
    override: overrideState(r.override),
  };
}

/* ---------- Matching API errors to fields ---------- */

/**
 * Find the error message for a field. The API names fields by their request path
 * (e.g. "large_conservatory_price", "property.price", "override.reason", "extras.1.price").
 * We match exactly, or by dotted/bracketed equivalents.
 */
export function errorFor(errors: FieldError[], ...fields: string[]): string | undefined {
  const norm = (f: string) => f.replace(/\[(\d+)\]/g, ".$1").replace(/^body\./, "");
  for (const e of errors) {
    const ef = norm(e.field);
    if (fields.some((f) => ef === f)) return e.message;
  }
  return undefined;
}

export function unmatchedErrors(errors: FieldError[], known: string[]): FieldError[] {
  return errors.filter((e) => errorFor([e], ...known) === undefined);
}
