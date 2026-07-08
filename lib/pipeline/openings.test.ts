import { describe, expect, it } from "vitest";
import { icpFromNaics, keepOpening, openingNotes } from "./openings";
import { estimateCompletionFromNotes, monthsUntil } from "../sourcing/criteria";

// Shapes from the live Comptroller feed (data.texas.gov jrea-zgmq, 2026-07).
const RESTAURANT = {
  taxpayer_number: "32112345678",
  outlet_number: "1",
  outlet_name: "WINGS OVER SPRING, LLC",
  outlet_address: "18602 KUYKENDAHL RD",
  outlet_city: "SPRING",
  outlet_zip_code: "77379",
  outlet_naics_code: "722513",
  outlet_permit_issue_date: "2026-07-02T00:00:00.000",
  outlet_first_sales_date: "2026-08-01T00:00:00.000",
};

describe("pipeline/openings", () => {
  it("keeps physical grounds-relevant outlets, drops the noise", () => {
    expect(keepOpening(RESTAURANT)).toBe(true);
    // online seller
    expect(keepOpening({ ...RESTAURANT, outlet_naics_code: "454110" })).toBe(false);
    // food truck (mobile food services)
    expect(keepOpening({ ...RESTAURANT, outlet_naics_code: "722330" })).toBe(false);
    // suite tenant / apartment
    expect(keepOpening({ ...RESTAURANT, outlet_address: "7100 BUSINESS PARK DR STE 180" })).toBe(false);
    expect(keepOpening({ ...RESTAURANT, outlet_address: "15727 CUTTEN RD APT 721" })).toBe(false);
    expect(keepOpening({ ...RESTAURANT, outlet_address: "5819 CHIPPEWA BLVD # TX" })).toBe(false);
    // unusable record
    expect(keepOpening({ ...RESTAURANT, outlet_address: undefined })).toBe(false);
  });

  it("maps NAICS to ICP buckets", () => {
    expect(icpFromNaics("722513")).toBe("retail_strip");
    expect(icpFromNaics("621111")).toBe("medical");
    expect(icpFromNaics("624410")).toBe("daycare");
    expect(icpFromNaics("531130")).toBe("self_storage");
    expect(icpFromNaics("811111")).toBe("industrial");
    expect(icpFromNaics("713940")).toBe("other");
  });

  it("notes drive the timing signal via Opens and the dossier via Owner:", () => {
    const notes = openingNotes({
      issueDateIso: "2026-07-02",
      name: "WINGS OVER SPRING, LLC",
      naics: "722513",
      opensIso: "2026-08-01",
      owner: "TYFYTITE PROPERTIES LLC",
    });
    // The score's timing/urgency signal reads the opening date as the
    // engage-by moment — ~1 month out lands in the urgent bid window.
    const est = estimateCompletionFromNotes(notes);
    expect(est).toEqual({ iso: "2026-08-01", assumed: false });
    expect(monthsUntil(est!.iso, new Date("2026-07-08"))).toBeGreaterThan(0);
    // The buyer job sheet extracts the owner via this exact pattern.
    expect(notes.match(/Owner: ([^.]+)\./)?.[1]).toBe("TYFYTITE PROPERTIES LLC");
    // Operator-only provenance, keyed for the property page's origin line.
    expect(notes).toMatch(/^Sales-tax registration 2026-07-02/);
  });

  it("notes without an opening date leave the timing signal off", () => {
    const notes = openingNotes({
      issueDateIso: "2026-07-02",
      name: "X",
      naics: "722513",
      opensIso: null,
      owner: null,
    });
    expect(estimateCompletionFromNotes(notes)).toBeNull();
  });
});
