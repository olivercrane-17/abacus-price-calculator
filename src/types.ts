// Shapes of the API contract (docs/spec.md). Money in requests is pounds, in responses pence.

export type Frequency = "4" | "6" | "8" | "12";
export type WindowsFrequency = Frequency | "one_off";
export type ConservatoryChoice = "none" | "standard" | "large";
export type GutterService = "clearance" | "outer" | "package3";
export type LanternSize = "small" | "medium" | "large";

export interface Config {
  price_list_date: string;
  windows: {
    frequencies: Frequency[];
    bedrooms: Record<
      string,
      {
        regular: Record<Frequency, number>;
        conservatory_addon: number;
        one_off: number;
        one_off_with_conservatory: number;
      }
    >;
    internal_multiplier: number;
    conservatory_roof: { external_per_panel: number; external_minimum: number; internal_per_panel: number };
    velux: { external_each: number; internal_each: number };
    lanterns: Record<LanternSize, { external: number; internal: number }>;
  };
  gutters: {
    services: Record<GutterService, string>;
    bedrooms: Record<string, null | Record<GutterService, { no_cons: number; with_cons: number }>>;
    heavily_soiled_multiplier: number;
    ask_about: string[];
  };
  warnings: Record<string, string>;
  contact: { phone: string; mobile: string; sales_mobile: string };
}

export type PropertyRequest =
  { kind: "standard"; bedrooms: number } | { kind: "other"; description: string; price?: number | null };

export interface OverrideRequest {
  total: number | null;
  reason: string;
}

export interface WindowsRequest {
  quote_type: "windows";
  property: PropertyRequest;
  frequency: WindowsFrequency;
  conservatory: ConservatoryChoice;
  large_conservatory_price: number | null;
  internal: boolean;
  conservatory_roof: { external_panels: number; internal_panels: number };
  velux: { external: number; internal: number };
  lanterns: Record<LanternSize, { external: number; internal: number }> & { larger_price: number | null };
  override: OverrideRequest | null;
}

export interface GuttersRequest {
  quote_type: "gutters";
  property: PropertyRequest;
  service: GutterService;
  conservatory: boolean;
  heavily_soiled: boolean;
  manual_price: number | null;
  extras: { name: string; selected: boolean; price: number | null }[];
  override: OverrideRequest | null;
}

export type QuoteRequest = WindowsRequest | GuttersRequest;

export interface QuoteLine {
  key: string;
  label: string;
  amount: number | null;
}

export interface QuoteWarning {
  key: string;
  message: string;
}

export interface ComparisonItem {
  frequency: Frequency;
  label: string;
  total: number;
  selected: boolean;
}

export interface QuoteResponse {
  quote_type: "windows" | "gutters";
  /** Short item name, e.g. "3 bed windows · every 4 weeks · conservatory". */
  title: string;
  /** Windows frequency, or null for gutters. */
  frequency: WindowsFrequency | null;
  basis: "per_visit" | "one_off";
  basis_label: string;
  lines: QuoteLine[];
  subtotal: number;
  override: { total: number; reason: string } | null;
  total: number;
  warnings: QuoteWarning[];
  comparison: ComparisonItem[] | null;
  summary_text: string;
}

export interface FieldError {
  field: string;
  message: string;
}

/* ---------- Basket ---------- */

export interface BasketItemResult {
  index: number;
  ok: boolean;
  quote: QuoteResponse | null;
  errors: FieldError[];
}

export interface BasketGroup {
  basis: "per_visit" | "one_off";
  frequency: Frequency | null;
  label: string;
  suffix: string;
  total: number;
  items: number;
}

export interface BasketResponse {
  count: number;
  items: BasketItemResult[];
  groups: BasketGroup[];
  summary_text: string;
}
