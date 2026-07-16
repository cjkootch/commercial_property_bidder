import { describe, expect, it } from "vitest";
import {
  normalizeAttomSale,
  normalizeResidentialSale,
  normalizeTarrantSale,
  MIN_HOME_VALUE,
  SINCE_DAYS,
} from "./residential-sourcing";

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
    expect(c!.sourceKey).toBe("hcad");
    expect(c!.account).toBe("1146780000012");
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

// Shape mirrors the live Tarrant Dynamic/TADParcels layer (2026-07): padded
// strings, epoch-ms DEED_DATE (with year-8201 sentinels in the wild), native
// SubdivisionName, "TARRANT COUNTY" riding in CITY for unincorporated rows.
const TAD_FIXTURE = {
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-97.31, 32.79],
        [-97.3, 32.79],
        [-97.3, 32.8],
        [-97.31, 32.8],
        [-97.31, 32.79],
      ],
    ],
  },
  properties: {
    ACCOUNT: "05697433",
    TAXPIN: "05697433",
    SITUS_ADDR: "963 N BEACH ST                ",
    CITY: "FORT WORTH                      ",
    ZIPCODE: "76111     ",
    DEED_DATE: 1775001600000, // 2026-04-01 UTC
    TOTAL_VALU: 550_082,
    LAND_SQFT: 27_580,
    YEAR_BUILT: 1984,
    SubdivisionName: "HARRISON ADDITION-FT WORTH",
    LIVING_ARE: 2784,
  },
};

const cloneTad = () => JSON.parse(JSON.stringify(TAD_FIXTURE));

describe("normalizeTarrantSale", () => {
  it("normalizes a live-shaped TAD feature (padded strings trimmed)", () => {
    const c = normalizeTarrantSale(cloneTad());
    expect(c).not.toBeNull();
    expect(c!.sourceKey).toBe("tad");
    expect(c!.account).toBe("05697433");
    expect(c!.address).toBe("963 N Beach St");
    expect(c!.city).toBe("Fort Worth");
    expect(c!.zip).toBe("76111");
    expect(c!.subdivision).toBe("Harrison Addition-Ft Worth");
    expect(c!.saleDateIso).toBe("2026-04-01");
    expect(c!.marketValue).toBe(550_082);
    expect(c!.lotSqft).toBe(27_580);
    expect(c!.yearBuilt).toBe(1984);
    expect(c!.lng).toBeGreaterThan(-97.31);
    expect(c!.lng).toBeLessThan(-97.3);
  });

  it("rejects sentinel far-future deed dates (year 8201 rows exist live)", () => {
    const f = cloneTad();
    f.properties.DEED_DATE = 196650547200000; // 8201-08-11
    expect(normalizeTarrantSale(f)).toBeNull();
  });

  it("nulls the unincorporated 'TARRANT COUNTY' pseudo-city and blank ZIPs", () => {
    const f = cloneTad();
    f.properties.CITY = "TARRANT COUNTY                  ";
    f.properties.ZIPCODE = "          ";
    const c = normalizeTarrantSale(f);
    expect(c).not.toBeNull();
    expect(c!.city).toBeNull();
    expect(c!.zip).toBeNull();
  });

  it("rejects rows without an account or deed date", () => {
    const noAcct = cloneTad();
    noAcct.properties.ACCOUNT = "";
    noAcct.properties.TAXPIN = "";
    expect(normalizeTarrantSale(noAcct)).toBeNull();

    const noDate = cloneTad();
    noDate.properties.DEED_DATE = null;
    expect(normalizeTarrantSale(noDate)).toBeNull();
  });
});

describe("normalizeAttomSale", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    properties: {
      identifier: { attomId: 987654 },
      address: { line1: "6657 COYOTE VALLEY TRL", locality: "CROWLEY", postal1: "76036" },
      location: { latitude: "32.5721", longitude: "-97.3695" },
      sale: { saleTransDate: "2026-07-01", amount: { saleAmt: 355020 } },
      summary: { propType: "SFR" },
      ...over,
    },
  });

  it("normalizes a fresh ATTOM sale (camelCase survives, price is the value)", () => {
    const c = normalizeAttomSale(row())!;
    expect(c.sourceKey).toBe("attom");
    expect(c.account).toBe("987654");
    expect(c.address).toBe("6657 Coyote Valley Trl");
    expect(c.city).toBe("Crowley");
    expect(c.zip).toBe("76036");
    expect(c.saleDateIso).toBe("2026-07-01");
    expect(c.marketValue).toBe(355020);
    expect(c.lat).toBeCloseTo(32.5721);
  });

  it("drops rows without a price or outside the volume band (the SFR screen)", () => {
    expect(normalizeAttomSale(row({ sale: { saleTransDate: "2026-07-01", amount: {} } }))).toBeNull();
    expect(
      normalizeAttomSale(row({ sale: { saleTransDate: "2026-07-01", amount: { saleAmt: 90000 } } }))
    ).toBeNull();
    expect(
      normalizeAttomSale(row({ sale: { saleTransDate: "2026-07-01", amount: { saleAmt: 9000000 } } }))
    ).toBeNull();
  });

  it("drops non-residential property types and dateless rows", () => {
    expect(normalizeAttomSale(row({ summary: { propType: "COMMERCIAL" } }))).toBeNull();
    expect(normalizeAttomSale(row({ sale: { amount: { saleAmt: 355020 } } }))).toBeNull();
  });
});
