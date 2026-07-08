import { describe, expect, it } from "vitest";
import { normalizeTaxSale, taxSaleNotes } from "./taxsales";
import { leadKind, displayName } from "../leads/market";

// Trimmed from the live LGBS API (taxsales.lgbs.com, 2026-07-08).
const SCHEDULED = {
  account_nbr: "0503460000030",
  prop_address_one: "3106 KIRK ST",
  prop_city: "HOUSTON",
  prop_zipcode: "77026-5838",
  status: "Scheduled for Auction",
  sale_date_only: "2026-08-04",
  value: "120059.00",
  cause_nbr: "202367306",
  geometry: { type: "Point", coordinates: [-95.326406, 29.789664] as [number, number] },
};

describe("pipeline/taxsales", () => {
  it("normalizes an LGBS record (title case, zip5, numeric value)", () => {
    const t = normalizeTaxSale(SCHEDULED);
    expect(t).not.toBeNull();
    expect(t!.accountNbr).toBe("0503460000030");
    expect(t!.address).toBe("3106 Kirk St");
    expect(t!.city).toBe("Houston");
    expect(t!.zip).toBe("77026");
    expect(t!.lat).toBeCloseTo(29.789664);
    expect(t!.lng).toBeCloseTo(-95.326406);
    expect(t!.saleDateIso).toBe("2026-08-04");
    expect(t!.value).toBe(120059);
  });

  it("drops records without account, address, or coordinates", () => {
    expect(normalizeTaxSale({ ...SCHEDULED, account_nbr: "" })).toBeNull();
    expect(normalizeTaxSale({ ...SCHEDULED, prop_address_one: "" })).toBeNull();
    expect(normalizeTaxSale({ ...SCHEDULED, geometry: null })).toBeNull();
  });

  it("scheduled-auction notes carry the urgency signal the market rank reads", () => {
    const notes = taxSaleNotes({
      accountNbr: "0503460000030",
      status: "Scheduled for Auction",
      saleDateIso: "2026-08-04",
      value: 120059,
      owner: "SMITH HOLDINGS LLC",
    });
    // Marketplace urgency + buyer card both extract via this pattern.
    expect(notes.match(/Tax sale scheduled ([\d-]+)/)?.[1]).toBe("2026-08-04");
    expect(notes.match(/Owner: ([^.]+)\./)?.[1]).toBe("SMITH HOLDINGS LLC");
  });

  it("future-sale notes say the stage honestly instead of inventing a date", () => {
    const notes = taxSaleNotes({
      accountNbr: "1",
      status: "Available for Future Sale",
      saleDateIso: null,
      value: null,
      owner: null,
    });
    expect(notes).toContain("available for future sale");
    expect(notes.match(/Tax sale scheduled/)).toBeNull();
  });

  it("TAX refs get the distress kind and strip from display names", () => {
    expect(leadKind("3106 Kirk St (TAX 0503460000030)")).toBe("distress");
    expect(displayName("3106 Kirk St (TAX 0503460000030)")).toBe("3106 Kirk St");
  });
});
