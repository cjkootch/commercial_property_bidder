import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvLine, toImportRow } from "./import";
import { companyKey, domainOf } from "./companies";
import { csvEscape, csvSafeText, toCsv } from "./export";

// The import path's correctness is entirely about two pure functions: the parser
// (does column 4 still mean column 4?) and the key (do two spellings of one
// company collapse to one row?). Both are tested here. The *idempotency* claim is
// enforced by database UNIQUE indexes, not by code — see PACKET.md, it cannot be
// unit-tested without a live Postgres.

describe("parseCsvLine", () => {
  it("keeps a comma inside quotes in one field", () => {
    // The source app's split(",") shifted every column right of a quoted comma,
    // which is how "Unit 4" ended up in the city column of a whole file.
    expect(parseCsvLine('Acme Inc,"123 Main St, Unit 4",Austin,TX')).toEqual([
      "Acme Inc",
      "123 Main St, Unit 4",
      "Austin",
      "TX",
    ]);
  });

  it('unescapes a doubled quote', () => {
    expect(parseCsvLine('"Bob ""Rusty"" Miller",owner')).toEqual(['Bob "Rusty" Miller', "owner"]);
  });

  it("preserves empty trailing fields so column count is stable", () => {
    expect(parseCsvLine("a,,c,")).toEqual(["a", "", "c", ""]);
  });
});

describe("parseCsv", () => {
  it("lowercases and underscores headers", () => {
    const rows = parseCsv("Company Name,Postal Code\nAcme,78701\n");
    expect(Object.keys(rows[0])).toEqual(["company_name", "postal_code"]);
  });

  it("strips a UTF-8 BOM (Excel writes one and it corrupts the first header)", () => {
    const rows = parseCsv("﻿name,city\nAcme,Austin\n");
    expect(rows[0].name).toBe("Acme");
  });

  it("handles CRLF line endings", () => {
    const rows = parseCsv("name,city\r\nAcme,Austin\r\n");
    expect(rows).toEqual([{ name: "Acme", city: "Austin" }]);
  });

  it("joins a quoted field that spans physical lines", () => {
    // This is the case the source parser got wrong: it split on "\n" first, so a
    // multi-line address became two malformed rows.
    const rows = parseCsv('name,address\nAcme,"123 Main St\nSuite 200"\nBeta,"1 Elm"\n');
    expect(rows).toHaveLength(2);
    expect(rows[0].address).toBe("123 Main St\nSuite 200");
    expect(rows[1].name).toBe("Beta");
  });

  it("returns [] for empty input rather than throwing", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });

  it("tolerates a short row (missing trailing columns become empty strings)", () => {
    const rows = parseCsv("name,city,state\nAcme\n");
    expect(rows[0]).toEqual({ name: "Acme", city: "", state: "" });
  });
});

describe("companyKey", () => {
  it("collapses corporate-suffix and punctuation variants to one key", () => {
    const k = companyKey("Acme Industries, Inc.");
    expect(companyKey("Acme Industries Inc")).toBe(k);
    expect(companyKey("ACME INDUSTRIES, LLC")).toBe(k);
    expect(companyKey("  Acme   Industries  ")).toBe(k);
  });

  it("normalizes an ampersand so it matches the spelled-out form", () => {
    expect(companyKey("Smith & Sons")).toBe(companyKey("Smith and Sons"));
  });

  it("does NOT merge genuinely different companies", () => {
    expect(companyKey("Acme Industries")).not.toBe(companyKey("Acme Industrial"));
  });

  it("returns an empty string for a name with no signal — the caller must reject it", () => {
    // importCompanies() checks for this and skips the row instead of writing a
    // company whose dedupe key would collide with every other junk row.
    expect(companyKey("Inc.")).toBe("");
    expect(companyKey("   ")).toBe("");
  });
});

describe("domainOf", () => {
  it("extracts a domain from a URL, an email, or a bare host", () => {
    expect(domainOf("https://www.acme.com/about")).toBe("acme.com");
    expect(domainOf("dana@acme.com")).toBe("acme.com");
    expect(domainOf("ACME.com")).toBe("acme.com");
    expect(domainOf("acme.com:8443")).toBe("acme.com");
  });

  it("returns null for anything that isn't a host", () => {
    expect(domainOf(null)).toBeNull();
    expect(domainOf("")).toBeNull();
    expect(domainOf("acme")).toBeNull();
  });
});

describe("toImportRow", () => {
  it("accepts any of the three name column spellings", () => {
    for (const col of ["name", "company", "company_name"]) {
      const r = toImportRow({ [col]: "Acme" });
      expect("error" in r ? null : r.name).toBe("Acme");
    }
  });

  it("reports an error instead of throwing when there is no name", () => {
    const r = toImportRow({ city: "Austin" });
    expect("error" in r && r.error).toMatch(/no name/);
  });

  it("maps cf_* columns to custom values and ignores unknown columns", () => {
    const r = toImportRow({ name: "Acme", cf_fit_score: "8", random_column: "x" });
    if ("error" in r) throw new Error("unexpected error");
    expect(r.custom).toEqual({ fit_score: "8" });
    // An unrecognized column must not fail a 5,000-row file.
    expect(r).not.toHaveProperty("random_column");
  });

  it("treats blank cells as absent rather than as empty strings", () => {
    const r = toImportRow({ name: "Acme", city: "   ", cf_fit_score: "" });
    if ("error" in r) throw new Error("unexpected error");
    expect(r.city).toBeNull();
    expect(r.custom).toBeUndefined();
  });

  it("accepts the common alias columns (url/zip/notes)", () => {
    const r = toImportRow({ name: "Acme", url: "acme.com", zip: "78701", notes: "referred" });
    if ("error" in r) throw new Error("unexpected error");
    expect([r.website, r.postal_code, r.description]).toEqual(["acme.com", "78701", "referred"]);
  });
});

describe("csv export", () => {
  it("quotes only what needs quoting and doubles embedded quotes", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape(null)).toBe("");
  });

  it("uses the explicit column order, not the first row's keys", () => {
    const csv = toCsv(["name", "city"], [{ city: "Austin", name: "Acme" }]);
    expect(csv).toBe("name,city\nAcme,Austin\n");
  });

  it("neutralizes a formula-injection payload", () => {
    // Company names come from CSVs and web forms; Excel executes a leading "=".
    expect(csvSafeText("=HYPERLINK(\"http://evil\",\"click\")")).toMatch(/^'=/);
    expect(csvSafeText("+1 512 555 0100")).toMatch(/^'\+/);
    expect(csvSafeText("Acme Inc")).toBe("Acme Inc");
  });
});
