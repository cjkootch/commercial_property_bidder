import { describe, expect, it } from "vitest";
import { normalizeResidentialSale, MIN_HOME_VALUE, SINCE_DAYS } from "./residential-sourcing";

// Shape mirrors the live HCAD parcel layer (same feed the commercial transfer
// pipeline reads) filtered to state_class A1 — exploded site_str_* fields,
// epoch-ms new_owner_date, string legal description with lot/block prefix.
const FIXTURE = {
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-95.55, 30.0],
        [-95.54, 30.0],
        [-95.54, 30.01],
        [-95.55, 30.01],
        [-95.55, 30.0],
      ],
    ],
  },
  properties: {
    HCAD_NUM: "1146780000012",
    acct_num: "1146780000012",
    state_class: "A1",
    site_str_pfx: "  ",
    site_str_num: 9414,
    site_str_num_sfx: "   ",
    site_str_name: "ROARING SPRINGS",
    site_str_sfx: "LN",
    site_str_sfx_dir: "  ",
    site_apt_num: "",
    site_city: "HOUSTON",
    site_zip: "77064",
    legal_dscr_1: "LT 12 BLK 3",
    legal_dscr_2: "WILLOWBROOK SEC 2",
    legal_dscr_3: null,
    new_owner_date: 1780185600000, // 2026-05-31 UTC
    total_market_val: 385_000,
    acreage_1: 0.176,
    yr_impr: 1994,
  },
};

const clone = () => JSON.parse(JSON.stringify(FIXTURE));

describe("normalizeResidentialSale", () => {
  it("normalizes a live-shaped A1 feature", () => {
    const c = normalizeResidentialSale(clone());
    expect(c).not.toBeNull();
    expect(c!.hcadNum).toBe("1146780000012");
    expect(c!.address).toContain("9414");
    expect(c!.address).toContain("Roaring Springs");
    expect(c!.city).toBe("Houston");
    expect(c!.zip).toBe("77064");
    expect(c!.saleDateIso).toBe("2026-05-31");
    expect(c!.marketValue).toBe(385_000);
    expect(c!.yearBuilt).toBe(1994);
    // Inside the parcel polygon.
    expect(c!.lng).toBeGreaterThan(-95.55);
    expect(c!.lng).toBeLessThan(-95.54);
    expect(c!.lat).toBeGreaterThan(30.0);
    expect(c!.lat).toBeLessThan(30.01);
  });

  it("takes the subdivision from the non-lot legal description lines", () => {
    const c = normalizeResidentialSale(clone());
    expect(c!.subdivision).toBe("Willowbrook Sec 2");
  });

  it("joins a subdivision that spans two legal lines and skips tract lines", () => {
    const f = clone();
    f.properties.legal_dscr_1 = "LT 30 BLK 49";
    f.properties.legal_dscr_2 = "FOREST COVE COUNTRY CLUB";
    f.properties.legal_dscr_3 = "ESTATES SEC 4";
    expect(normalizeResidentialSale(f)!.subdivision).toBe("Forest Cove Country Club Estates Sec 4");

    const g = clone();
    g.properties.legal_dscr_1 = "LT 8 &";
    g.properties.legal_dscr_2 = "TRS 4B & 5A BLK 1";
    g.properties.legal_dscr_3 = "THE COURTYARDS AT LILLIAN";
    expect(normalizeResidentialSale(g)!.subdivision).toBe("The Courtyards At Lillian");
  });

  it("drops the replat suffix from the subdivision name", () => {
    const f = clone();
    f.properties.legal_dscr_2 = "BROOKGLEN SEC 1 R/P";
    expect(normalizeResidentialSale(f)!.subdivision).toBe("Brookglen Sec 1");
  });

  it("converts acreage to lot square feet", () => {
    const c = normalizeResidentialSale(clone());
    expect(c!.lotSqft).toBe(Math.round(0.176 * 43_560));
  });

  it("rejects features without geometry or a sale date", () => {
    const noGeom = clone();
    noGeom.geometry = null;
    expect(normalizeResidentialSale(noGeom)).toBeNull();

    const noDate = clone();
    noDate.properties.new_owner_date = null;
    expect(normalizeResidentialSale(noDate)).toBeNull();
  });

  it("nulls unusable numerics instead of rejecting the row", () => {
    const f = clone();
    f.properties.total_market_val = 0;
    f.properties.acreage_1 = "";
    f.properties.yr_impr = 0;
    const c = normalizeResidentialSale(f);
    expect(c).not.toBeNull();
    expect(c!.marketValue).toBeNull();
    expect(c!.lotSqft).toBeNull();
    expect(c!.yearBuilt).toBeNull();
  });

  it("keeps the volume-model floor and freshness window sane", () => {
    // Guard rails, not tuning: a $0 floor sells worthless addresses; a year-old
    // "new mover" isn't one.
    expect(MIN_HOME_VALUE).toBeGreaterThanOrEqual(100_000);
    expect(SINCE_DAYS).toBeLessThanOrEqual(90);
  });
});
