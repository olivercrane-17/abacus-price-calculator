import { describe, expect, it } from "vitest";
import type { PricedItem } from "./basket";
import { emptyCustomer, type Customer } from "./customer";
import {
  canSend,
  customerErrorField,
  sendCheck,
  sendFingerprint,
  stableStringify,
  type BasketState,
} from "./pipedrive";
import type { QuoteRequest, QuoteResponse, WindowsRequest } from "./types";

const customer = (patch: Partial<Customer> = {}): Customer => ({ ...emptyCustomer(), ...patch });
const jane = customer({ name: "Jane Smith", phone: "07920 422778" });

const windows = (bedrooms = 3, patch: Partial<WindowsRequest> = {}): WindowsRequest => ({
  quote_type: "windows",
  property: { kind: "standard", bedrooms },
  frequency: "4",
  conservatory: "none",
  large_conservatory_price: null,
  internal: false,
  conservatory_roof: { external_panels: 0, internal_panels: 0 },
  velux: { external: 0, internal: 0 },
  lanterns: {
    small: { external: 0, internal: 0 },
    medium: { external: 0, internal: 0 },
    large: { external: 0, internal: 0 },
    larger_price: null,
  },
  override: null,
  ...patch,
});

const quote = { title: "3 bed windows", total: 2500 } as QuoteResponse;
const priced = (request: QuoteRequest = windows()): PricedItem => ({
  item: { id: `i-${Math.random()}`, request },
  result: { ok: true, quote, errors: [] },
});
const attention = (): PricedItem => ({
  item: { id: "bad", request: windows() },
  result: { ok: false, quote: null, errors: [{ field: "property", message: "Check this" }] },
});
const unpriced = (): PricedItem => ({ item: { id: "new", request: windows() }, result: null });

const basket = (items: PricedItem[], patch: Partial<BasketState> = {}): BasketState => ({
  items,
  stale: false,
  failed: false,
  ...patch,
});

describe("sendCheck", () => {
  it("allows a priced basket with a name and a phone number", () => {
    expect(sendCheck(basket([priced(), priced()]), jane)).toEqual({ ok: true, reason: "", field: null });
    expect(canSend(basket([priced()]), jane)).toBe(true);
  });

  it("accepts an email instead of a phone number", () => {
    expect(canSend(basket([priced()]), customer({ name: "Jane", email: "jane@example.com" }))).toBe(true);
  });

  it("asks for the name and a phone number or email", () => {
    const c = sendCheck(basket([priced()]), customer());
    expect(c.ok).toBe(false);
    expect(c.reason).toBe("Add the customer's name and a phone number or email to send.");
    expect(c.field).toBe("name");
  });

  it("asks only for what's missing, pointing at that field", () => {
    expect(sendCheck(basket([priced()]), customer({ name: "Jane" }))).toEqual({
      ok: false,
      reason: "Add a phone number or email to send.",
      field: "phone",
    });
    expect(sendCheck(basket([priced()]), customer({ email: "jane@example.com" }))).toEqual({
      ok: false,
      reason: "Add the customer's name to send.",
      field: "name",
    });
  });

  it("treats whitespace as empty, like the server", () => {
    expect(canSend(basket([priced()]), customer({ name: "  ", phone: "07920 422778" }))).toBe(false);
    expect(canSend(basket([priced()]), customer({ name: "Jane", phone: " ", email: "\t" }))).toBe(false);
  });

  it("needs at least one job", () => {
    expect(sendCheck(basket([]), jane)).toEqual({ ok: false, reason: "Add a job to send.", field: null });
    expect(sendCheck(basket([]), customer()).reason).toBe(
      "Add a job, the customer's name and a phone number or email to send.",
    );
  });

  it("blocks jobs that need attention", () => {
    expect(sendCheck(basket([priced(), attention()]), jane)).toEqual({
      ok: false,
      reason: "Fix the jobs marked Needs attention to send.",
      field: null,
    });
    const both = sendCheck(basket([attention()]), customer({ name: "Jane" }));
    expect(both.reason).toBe("Fix the jobs marked Needs attention, and add a phone number or email, to send.");
    expect(both.field).toBe("phone");
  });

  it("waits while the prices are out of date", () => {
    expect(sendCheck(basket([priced()], { stale: true }), jane)).toEqual({
      ok: false,
      reason: "Updating the prices…",
      field: null,
    });
    expect(sendCheck(basket([unpriced()]), jane).ok).toBe(false);
    expect(sendCheck(basket([priced()], { stale: true, failed: true }), jane).reason).toMatch(/need updating/);
  });

  it("asks for the customer before mentioning a price update", () => {
    expect(sendCheck(basket([priced()], { stale: true }), customer()).field).toBe("name");
  });
});

describe("sendFingerprint", () => {
  const items = [windows(3), windows(4, { frequency: "8" })];

  it("is the same for the same basket and customer", () => {
    expect(sendFingerprint(items, jane)).toBe(sendFingerprint(structuredClone(items), { ...jane }));
  });

  it("ignores key order (a basket reloaded from storage)", () => {
    const reordered = items.map((r) => Object.fromEntries(Object.entries(r).reverse()) as QuoteRequest);
    expect(sendFingerprint(reordered, jane)).toBe(sendFingerprint(items, jane));
  });

  it("changes when a job is added, removed, edited or reordered", () => {
    const base = sendFingerprint(items, jane);
    expect(sendFingerprint([...items, windows(2)], jane)).not.toBe(base);
    expect(sendFingerprint(items.slice(0, 1), jane)).not.toBe(base);
    expect(sendFingerprint([windows(3, { internal: true }), items[1]], jane)).not.toBe(base);
    expect(sendFingerprint([items[1], items[0]], jane)).not.toBe(base);
  });

  it("changes when any customer detail that's sent changes", () => {
    const base = sendFingerprint(items, jane);
    for (const patch of [
      { name: "Jane Smyth" },
      { phone: "07920 422779" },
      { email: "jane@example.com" },
      { line1: "1 High Street" },
      { postcode: "GU9 8AB" },
      { notes: "Dog in garden" },
      { contactMethod: "text" as const },
      { heardVia: "google" as const },
    ]) {
      expect(sendFingerprint(items, { ...jane, ...patch }), JSON.stringify(patch)).not.toBe(base);
    }
  });

  it("ignores surrounding spaces, the town's lookup flag and a hidden 'Other' text", () => {
    const base = sendFingerprint(items, jane);
    expect(sendFingerprint(items, { ...jane, name: "  Jane Smith " })).toBe(base);
    expect(sendFingerprint(items, { ...jane, townAuto: true })).toBe(base);
    expect(sendFingerprint(items, { ...jane, heardOther: "Parish magazine" })).toBe(base);
    expect(sendFingerprint(items, { ...jane, heardVia: "other", heardOther: "Parish magazine" })).not.toBe(
      sendFingerprint(items, { ...jane, heardVia: "other" }),
    );
  });

  it("is a short hash, not the customer's details", () => {
    const fp = sendFingerprint(items, jane);
    expect(fp).toMatch(/^[0-9a-z]{1,12}$/);
    expect(fp).not.toContain("jane");
  });
});

describe("stableStringify", () => {
  it("sorts keys at every level and drops undefined", () => {
    expect(stableStringify({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: undefined } })).toBe(
      '{"a":{"d":[1,{"e":3,"f":2}]},"b":1}',
    );
  });

  it("keeps array order and nulls", () => {
    expect(stableStringify([3, null, "x"])).toBe('[3,null,"x"]');
  });
});

describe("customerErrorField", () => {
  it("maps the server's customer errors to the fields", () => {
    expect(customerErrorField("customer.name")).toBe("name");
    expect(customerErrorField("customer.phone")).toBe("phone");
    expect(customerErrorField("items")).toBeNull();
    expect(customerErrorField("customer")).toBeNull();
  });
});
