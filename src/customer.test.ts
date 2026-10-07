import { describe, expect, it } from "vitest";
import {
  basketRecord,
  capitaliseWords,
  customerBlock,
  customerIsEmpty,
  emailTypoSuggestion,
  emptyCustomer,
  firstName,
  formatPostcodeAsTyped,
  formatUkPhone,
  isFullPostcode,
  phoneLooksValid,
  type Customer,
} from "./customer";

const customer = (patch: Partial<Customer>): Customer => ({ ...emptyCustomer(), ...patch });
const RULE = "-".repeat(40);

describe("formatUkPhone", () => {
  it("formats mobiles and landlines", () => {
    expect(formatUkPhone("07920422778")).toBe("07920 422778");
    expect(formatUkPhone("01252834238")).toBe("01252 834238");
    expect(formatUkPhone("07920 422 778")).toBe("07920 422778");
  });

  it("formats London and 4-digit area codes", () => {
    expect(formatUkPhone("02079460018")).toBe("020 7946 0018");
    expect(formatUkPhone("01134960000")).toBe("0113 496 0000");
    expect(formatUkPhone("08001234567")).toBe("0800 123 4567");
  });

  it("formats +44 numbers", () => {
    expect(formatUkPhone("+447920422778")).toBe("+44 7920 422778");
    expect(formatUkPhone("+44 (0)7920 422778")).toBe("+44 7920 422778");
    expect(formatUkPhone("00447920422778")).toBe("+44 7920 422778");
  });

  it("leaves anything it can't parse exactly as typed", () => {
    for (const t of ["", "0792042277", "ring after 6", "+33 1 23 45 67 89", " 079204227789 "]) {
      expect(formatUkPhone(t)).toBe(t);
    }
  });
});

describe("phoneLooksValid", () => {
  it("accepts blank and UK numbers", () => {
    expect(phoneLooksValid("")).toBe(true);
    expect(phoneLooksValid("07920 422778")).toBe(true);
    expect(phoneLooksValid("01252834238")).toBe(true);
    expect(phoneLooksValid("+44 7920 422778")).toBe(true);
  });

  it("flags short, long or non-UK numbers", () => {
    expect(phoneLooksValid("0792042277")).toBe(false);
    expect(phoneLooksValid("079204227789")).toBe(false);
    expect(phoneLooksValid("06123456789")).toBe(false);
    expect(phoneLooksValid("+33 1 23 45 67 89")).toBe(false);
    expect(phoneLooksValid("call me")).toBe(false);
  });
});

describe("emailTypoSuggestion", () => {
  it.each([
    ["jane@gmial.com", "jane@gmail.com"],
    ["jane@gmail.con", "jane@gmail.com"],
    ["jane@hotmial.com", "jane@hotmail.com"],
    ["jane@yahoo.co", "jane@yahoo.co.uk"],
    ["jane@outlok.com", "jane@outlook.com"],
    ["Jane.Smith@GMAIL.CON", "Jane.Smith@gmail.com"],
  ])("suggests a fix for %s", (typed, fix) => {
    expect(emailTypoSuggestion(typed)).toBe(fix);
  });

  it("returns null for correct or unfinished addresses", () => {
    for (const t of [
      "jane@gmail.com",
      "jane@hotmail.co.uk",
      "jane@mail.com",
      "jane@abacus-windows.co.uk",
      "jane@",
      "jane",
      "",
    ]) {
      expect(emailTypoSuggestion(t)).toBeNull();
    }
  });
});

describe("postcodes", () => {
  it("formats as typed, adding the space once it's complete", () => {
    expect(formatPostcodeAsTyped("gu98ab")).toBe("GU9 8AB");
    expect(formatPostcodeAsTyped("gu9 8ab")).toBe("GU9 8AB");
    expect(formatPostcodeAsTyped("sw1a1aa")).toBe("SW1A 1AA");
    expect(formatPostcodeAsTyped("gu9")).toBe("GU9");
    expect(formatPostcodeAsTyped("gu9 8")).toBe("GU9 8");
    expect(formatPostcodeAsTyped(" gu9-8ab")).toBe("GU9 8AB");
  });

  it("knows a complete postcode", () => {
    expect(isFullPostcode("GU9 8AB")).toBe(true);
    expect(isFullPostcode("m11ae")).toBe(true);
    expect(isFullPostcode("GU9 8A")).toBe(false);
    expect(isFullPostcode("hello")).toBe(false);
  });
});

describe("names", () => {
  it("capitalises each word as typed", () => {
    expect(capitaliseWords("jane smith-jones")).toBe("Jane Smith-Jones");
    expect(capitaliseWords("o'brien")).toBe("O'Brien");
    expect(capitaliseWords("McDonald")).toBe("McDonald");
  });

  it("picks the first name", () => {
    expect(firstName("  Jane   Smith ")).toBe("Jane");
    expect(firstName("")).toBe("");
  });
});

describe("customerBlock", () => {
  it("is empty when nothing is filled in", () => {
    expect(customerBlock(emptyCustomer())).toBe("");
    expect(customerBlock(customer({ name: "   " }))).toBe("");
    expect(customerIsEmpty(customer({ notes: " " }))).toBe(true);
  });

  it("lists every field in order", () => {
    const c = customer({
      name: "Jane Smith",
      line1: "1 Example Road",
      town: "Farnham",
      county: "Surrey",
      postcode: "GU9 8AB",
      phone: "07920 422778",
      email: "jane@gmail.com",
      contactMethod: "text",
      heardVia: "recommendation",
      notes: "Gate code 1234\ndog in garden",
    });
    expect(customerBlock(c)).toBe(
      [
        "CUSTOMER",
        "Name: Jane Smith",
        "Address: 1 Example Road, Farnham, Surrey, GU9 8AB",
        "Phone: 07920 422778",
        "Email: jane@gmail.com",
        "Prefers: Text message",
        "Heard via: Recommendation",
        "Notes: Gate code 1234; dog in garden",
        RULE,
      ].join("\n"),
    );
  });

  it("includes only the fields that are filled in", () => {
    expect(customerBlock(customer({ name: "Jane", phone: "07920 422778" }))).toBe(
      ["CUSTOMER", "Name: Jane", "Phone: 07920 422778", RULE].join("\n"),
    );
    expect(customerBlock(customer({ postcode: "GU9 8AB" }))).toBe(["CUSTOMER", "Address: GU9 8AB", RULE].join("\n"));
  });

  it("writes the Other heard-via text", () => {
    expect(customerBlock(customer({ heardVia: "other", heardOther: "Parish magazine" }))).toBe(
      ["CUSTOMER", "Heard via: Other (Parish magazine)", RULE].join("\n"),
    );
    expect(customerBlock(customer({ heardVia: "other" }))).toContain("Heard via: Other\n");
  });
});

describe("basketRecord", () => {
  const jane = customer({ name: "Jane" });
  it("puts the customer block before the basket summary", () => {
    expect(basketRecord(jane, "BASKET", true)).toBe(`CUSTOMER\nName: Jane\n${RULE}\n\nBASKET`);
  });
  it("copies just the customer when there are no jobs", () => {
    expect(basketRecord(jane, null, false)).toBe(`CUSTOMER\nName: Jane\n${RULE}\n\nNo jobs in basket`);
  });
  it("is the summary alone without a customer, and nothing while jobs are pricing", () => {
    expect(basketRecord(emptyCustomer(), "BASKET", true)).toBe("BASKET");
    expect(basketRecord(emptyCustomer(), null, false)).toBeNull();
    expect(basketRecord(jane, null, true)).toBeNull();
  });
});
