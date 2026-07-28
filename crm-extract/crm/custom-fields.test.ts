import { describe, expect, it } from "vitest";
import { coerceValue, readValue } from "./custom-fields";
import { MARKETING_ONLY_REASONS, rowsBlockTransactional } from "../email/suppression";
import type { CustomFieldDef } from "../db/schema";

const def = (
  type: CustomFieldDef["type"],
  options: string[] | null = null,
  label = "Field"
): Pick<CustomFieldDef, "type" | "options" | "label"> => ({ type, options, label });

// coerceValue is the boundary between "a string typed into a form or pasted from a
// spreadsheet" and "a typed column". It is pure so the same validation runs on
// import, on the record page, and in a future API — one definition of valid.

describe("coerceValue", () => {
  it("writes exactly one column per type and leaves the rest null", () => {
    const cases: Array<[Parameters<typeof coerceValue>[0], unknown, keyof NonNullable<ReturnType<typeof coerceValue> extends { ok: true; patch: infer P } ? P : never>]> = [
      [def("number"), "42", "num_value"],
      [def("text"), "hello", "text_value"],
      [def("enum", ["a", "b"]), "b", "text_value"],
      [def("boolean"), "yes", "bool_value"],
      [def("date"), "2027-03-01", "date_value"],
    ];
    for (const [d, raw, col] of cases) {
      const r = coerceValue(d, raw);
      if (!r.ok) throw new Error(`expected ok for ${d.type}: ${r.error}`);
      const populated = Object.entries(r.patch).filter(([, v]) => v !== null).map(([k]) => k);
      expect(populated).toEqual([col]);
    }
  });

  it("clears every column when the value is blank (clearing a field is legal)", () => {
    for (const blank of [null, undefined, ""]) {
      const r = coerceValue(def("number"), blank);
      expect(r.ok && r.patch).toEqual({
        num_value: null,
        text_value: null,
        bool_value: null,
        date_value: null,
      });
    }
  });

  it("accepts spreadsheet-formatted numbers", () => {
    // "$1,250,000" is what a banker actually pastes into a revenue field.
    const r = coerceValue(def("number"), "$1,250,000");
    expect(r.ok && r.patch.num_value).toBe(1250000);
    const neg = coerceValue(def("number"), "-3.5");
    expect(neg.ok && neg.patch.num_value).toBe(-3.5);
  });

  it("rejects a non-number with a message naming the field", () => {
    const r = coerceValue(def("number", null, "Fit score"), "high");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("Fit score");
  });

  it("enforces the enum's option list and lists the options in the error", () => {
    const d = def("enum", ["Retiring", "Growth capital"], "Owner situation");
    expect(coerceValue(d, "Retiring").ok).toBe(true);
    const bad = coerceValue(d, "retiring"); // case-sensitive on purpose
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain("Growth capital");
  });

  it("treats an enum with no options as accepting nothing rather than everything", () => {
    // Fail closed: a misconfigured def must not become a free-text column.
    expect(coerceValue(def("enum", null), "anything").ok).toBe(false);
  });

  it("reads the truthy spellings a checkbox or CSV produces", () => {
    for (const t of [true, "true", "1", "yes", "on", "YES"]) {
      expect(coerceValue(def("boolean"), t).ok && coerceValue(def("boolean"), t)).toMatchObject({
        patch: { bool_value: true },
      });
    }
    for (const f of [false, "false", "0", "no", "off", "maybe"]) {
      expect(coerceValue(def("boolean"), f)).toMatchObject({ patch: { bool_value: false } });
    }
  });

  it("requires ISO dates and rejects a date that doesn't exist", () => {
    expect(coerceValue(def("date"), "2027-03-01").ok).toBe(true);
    expect(coerceValue(def("date"), "03/01/2027").ok).toBe(false);
    expect(coerceValue(def("date"), "2027-02-30").ok).toBe(false);
  });

  it("truncates absurdly long text instead of failing the row", () => {
    const r = coerceValue(def("text"), "x".repeat(9000));
    expect(r.ok && r.patch.text_value?.length).toBe(4000);
  });
});

describe("readValue", () => {
  const row = { num_value: 7, text_value: "Retiring", bool_value: true, date_value: "2027-03-01" };

  it("returns the column the def's type points at", () => {
    expect(readValue(def("number"), row)).toBe(7);
    expect(readValue(def("text"), row)).toBe("Retiring");
    expect(readValue(def("enum"), row)).toBe("Retiring");
    expect(readValue(def("boolean"), row)).toBe(true);
    expect(readValue(def("date"), row)).toBe("2027-03-01");
  });

  it("returns null for a record with no stored value", () => {
    expect(readValue(def("number"), undefined)).toBeNull();
  });

  it("round-trips through coerceValue", () => {
    const d = def("number");
    const w = coerceValue(d, "8");
    if (!w.ok) throw new Error("write failed");
    expect(readValue(d, w.patch)).toBe(8);
  });
});

// The suppression split is here because it is the same class of bug as the revisit
// predicate — silent, and expensive. The source app blocked purchases on a
// marketing opt-out and lost paying customers to it.

describe("rowsBlockTransactional", () => {
  it("a marketing opt-out does NOT block transactional mail", () => {
    for (const reason of MARKETING_ONLY_REASONS) {
      expect(rowsBlockTransactional([{ reason }])).toBe(false);
    }
  });

  it("a bounce or complaint blocks everything", () => {
    expect(rowsBlockTransactional([{ reason: "resend bounce" }])).toBe(true);
    expect(rowsBlockTransactional([{ reason: "resend complaint" }])).toBe(true);
  });

  it("an unlabelled row blocks everything (unknown reason fails closed)", () => {
    expect(rowsBlockTransactional([{ reason: null }])).toBe(true);
    expect(rowsBlockTransactional([{ reason: "" }])).toBe(true);
  });

  it("one hard signal outweighs any number of marketing opt-outs", () => {
    expect(
      rowsBlockTransactional([{ reason: "unsubscribe" }, { reason: "resend bounce" }])
    ).toBe(true);
  });

  it("no rows means not blocked", () => {
    expect(rowsBlockTransactional([])).toBe(false);
  });
});
