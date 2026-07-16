import { describe, expect, it } from "vitest";
import { normalizeExpandedProfile, usdShort } from "./attom";

// Shape mirrors a real /property/expandedprofile response (heavily trimmed).
const SAMPLE = {
  status: { code: 0, msg: "SuccessWithResult" },
  property: [
    {
      lot: { lotsize1: 1.2, lotsize2: 52272 },
      summary: { proptype: "COMMERCIAL", yearbuilt: 1998 },
      building: { size: { bldgsize: 24500, universalsize: 24500 } },
      assessment: {
        assessed: { assdttlvalue: 1850000 },
        market: { mktttlvalue: 2100000 },
        owner: {
          owner1: { lastname: "WESTCHASE PLAZA LLC" },
          mailingaddressoneline: "PO BOX 4519, HOUSTON, TX 77210",
        },
      },
      sale: { saleTransDate: "2021-03-15", amount: { saleamt: 1650000 } },
    },
  ],
};

describe("normalizeExpandedProfile", () => {
  it("pulls owner, values, building, and last sale from the nested response", () => {
    const f = normalizeExpandedProfile(SAMPLE)!;
    expect(f.status).toBe("ok");
    expect(f.owner).toBe("WESTCHASE PLAZA LLC");
    expect(f.owner_mailing).toContain("PO BOX 4519");
    expect(f.assessed_value).toBe(1850000);
    expect(f.market_value).toBe(2100000);
    expect(f.building_sqft).toBe(24500);
    expect(f.lot_sqft).toBe(52272);
    expect(f.year_built).toBe(1998);
    expect(f.last_sale_date).toBe("2021-03-15");
    expect(f.last_sale_price).toBe(1650000);
  });

  it("survives missing branches (commercial parcels omit whole sections)", () => {
    const f = normalizeExpandedProfile({ property: [{ summary: { proptype: "COMMERCIAL" } }] })!;
    expect(f.status).toBe("ok");
    expect(f.owner).toBeNull();
    expect(f.assessed_value).toBeNull();
    expect(f.building_sqft).toBeNull();
    expect(f.last_sale_date).toBeNull();
  });

  it("returns null when there is no property at all", () => {
    expect(normalizeExpandedProfile({ status: { msg: "SuccessWithoutResult" } })).toBeNull();
    expect(normalizeExpandedProfile(null)).toBeNull();
  });

  it("treats zero values as absent, not $0", () => {
    const f = normalizeExpandedProfile({
      property: [{ assessment: { assessed: { assdttlvalue: 0 } } }],
    })!;
    expect(f.assessed_value).toBeNull();
  });
});

describe("usdShort", () => {
  it("renders human money", () => {
    expect(usdShort(2100000)).toBe("$2.1M");
    expect(usdShort(52000)).toBe("$52k");
    expect(usdShort(850)).toBe("$850");
    expect(usdShort(null)).toBeNull();
  });
});
