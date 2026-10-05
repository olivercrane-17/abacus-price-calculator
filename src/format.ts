const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

/** Format integer pence as £27.00. */
export function formatPence(pence: number): string {
  return gbp.format(pence / 100);
}

/** Format a pounds value from the price list (display only), dropping .00 for whole pounds. */
export function formatPounds(pounds: number): string {
  return Number.isInteger(pounds) ? `£${pounds}` : gbp.format(pounds);
}

/**
 * Parse a pounds input. Empty → null. Accepts "12.50", "£12.50", "1,200".
 * Returns NaN-free numbers only; unparseable text is returned as null with ok=false.
 */
export function parsePounds(text: string): { value: number | null; ok: boolean } {
  const cleaned = text.replace(/[£,\s]/g, "");
  if (cleaned === "") return { value: null, ok: true };
  if (!/^\d*(\.\d{0,2})?$/.test(cleaned) || cleaned === ".") return { value: null, ok: false };
  return { value: Number(cleaned), ok: true };
}
