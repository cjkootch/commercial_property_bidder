import { describe, expect, it } from "vitest";
import { normalizeExpandedProfile, usdShort } from "./attom";

// Mirrors the REAL /property/expandedprofile casing (camelCase — verified
// against a live response 2026-07-16; the original lowercase fixture hid a
// parser bug that reported rich records as empty).
const SAMPLE = {
  status: { code: 0, msg: "SuccessWithResult" },
  property: [
    {
      lot: { lotsize1: 1.2, lotsize2: 52272 },
      summary: {
        propType: "SFR",
        propertyType: "SINGLE FAMILY RESIDENCE",
        yearBuilt: 2002,
        absenteeInd: "OWNER OCCUPIED",
      },
      building: { size: { bldgSize: 3062, universalSize: 3062, livingSize: 3062 } },
      assessment: {
        assessed: { assdTtlValue: 365816 },
        market: { mktTtlValue: 365816 },
        owner: {
          owner1: { fullName: "OLUBUKOLA AKINDOLIRE", lastName: "AKINDOLIRE" },
          owner2: { fullName: "OLAYEMI IBIDOKUN", lastName: "IBIDOKUN" },
          absenteeOwnerStatus: "O",
          mailingAddressOneLine: "1801 ST LAWRENCE WAY, ARLINGTON, TX 76002-4057",
        },
      },
      sale: { saleTransDate: "2025-12-05", amount: { saleAmt: 485000 } },
    },
  ],
};

describe("normalizeExpandedProfile", () => {
  it("parses the real camelCase response (owner names, values, sale)", () => {
    const f = normalizeExpandedProfile(SAMPLE)!;
    expect(f.status).toBe("ok");
    expect(f.owner).toBe("OLUBUKOLA AKINDOLIRE & OLAYEMI IBIDOKUN");
    expect(f.owner_mailing).toContain("1801 ST LAWRENCE WAY");
    expect(f.absentee).toBe(false);
    expect(f.assessed_value).toBe(365816);
    expect(f.market_value).toBe(365816);
    expect(f.building_sqft).toBe(3062);
    expect(f.lot_sqft).toBe(52272);
    expect(f.year_built).toBe(2002);
    expect(f.property_type).toBe("SFR");
    expect(f.last_sale_date).toBe("2025-12-05");
    expect(f.last_sale_price).toBe(485000);
  });

  it("parses all-lowercase casing identically (older vintages)", () => {
    const f = normalizeExpandedProfile({
      property: [
        {
          summary: { proptype: "COMMERCIAL", yearbuilt: 1998 },
          assessment: {
            assessed: { assdttlvalue: 1850000 },
            owner: {
              owner1: { lastname: "WESTCHASE PLAZA LLC" },
              absenteeownerstatus: "A",
              mailingaddressoneline: "PO BOX 4519, HOUSTON, TX 77210",
            },
          },
        },
      ],
    })!;
    expect(f.owner).toBe("WESTCHASE PLAZA LLC");
    expect(f.absentee).toBe(true);
    expect(f.assessed_value).toBe(1850000);
  });

  it("survives missing branches (commercial parcels omit whole sections)", () => {
    const f = normalizeExpandedProfile({ property: [{ summary: { propType: "COMMERCIAL" } }] })!;
    expect(f.status).toBe("ok");
    expect(f.owner).toBeNull();
    expect(f.absentee).toBeNull();
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
      property: [{ assessment: { assessed: { assdTtlValue: 0 } } }],
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
