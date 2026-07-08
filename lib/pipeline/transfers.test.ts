import { describe, expect, it } from "vitest";
import {
  assembleSiteAddress,
  epochToIso,
  geometryCenter,
  normalizeTransfer,
  titleCase,
  transferNotes,
} from "./transfers";
import {
  estimateCompletionFromNotes,
  isRecentOwnerChange,
} from "../sourcing/criteria";

// Trimmed from a real HCAD feature returned by the live layer (2026-07):
// exploded site_str_* fields, epoch-ms date, string "Acreage" with a numeric
// acreage_1 twin, and a GeoJSON polygon.
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
    HCAD_NUM: "1366890010003",
    acct_num: "1366890010003",
    owner_name_1: "HERITAGE PARK MANAGEMENT LLC",
    mail_addr_1: "6060 RICHMOND AVENUE STE 380",
    mail_addr_2: "",
    mail_city: "HOUSTON",
    mail_state: "TX",
    mail_zip: "77057-6224",
    site_str_pfx: "  ",
    site_str_num: 13220,
    site_str_num_sfx: "   ",
    site_str_name: "BRETON RIDGE",
    site_str_sfx: "ST",
    site_str_sfx_dir: "  ",
    site_city: "HOUSTON",
    site_zip: "77070",
    state_class: "F1",
    total_market_val: 16119067,
    new_owner_date: 1767052800000, // 2025-12-30
    legal_dscr_2: "MEDICAL RESORT AT WILLOWBROOK",
    Acreage: "6.0130 AC", // string! the numeric twin below is the real value
    acreage_1: 6.013,
    dscr: "WILLOWBROOK COM ANX",
  },
};

describe("pipeline/transfers", () => {
  it("assembles the site address from HCAD's exploded, space-padded fields", () => {
    expect(assembleSiteAddress(FIXTURE.properties)).toBe("13220 Breton Ridge St");
    // street number 0 = no number on record; the name alone still works
    expect(
      assembleSiteAddress({ site_str_num: 0, site_str_name: "SPRINGWOODS VILLAGE", site_str_sfx: "PKY" })
    ).toBe("Springwoods Village Pky");
    // no street name -> unusable
    expect(assembleSiteAddress({ site_str_num: 13220 })).toBeNull();
  });

  it("title-cases county ALL-CAPS strings", () => {
    expect(titleCase("HOUSTON")).toBe("Houston");
  });

  it("converts HCAD epoch-ms dates and rejects junk", () => {
    expect(epochToIso(1767052800000)).toBe("2025-12-30");
    expect(epochToIso(null)).toBeNull();
    expect(epochToIso("not a date")).toBeNull();
  });

  it("centers a polygon bbox", () => {
    const c = geometryCenter(FIXTURE.geometry);
    expect(c?.[0]).toBeCloseTo(-95.545, 3);
    expect(c?.[1]).toBeCloseTo(30.005, 3);
  });

  it("normalizes a live feature into a candidate with a Harris ParcelResult", () => {
    const t = normalizeTransfer(FIXTURE)!;
    expect(t).not.toBeNull();
    expect(t.hcadNum).toBe("1366890010003");
    expect(t.address).toBe("13220 Breton Ridge St");
    expect(t.city).toBe("Houston");
    expect(t.zip).toBe("77070");
    expect(t.saleDateIso).toBe("2025-12-30");
    expect(t.marketValue).toBe(16119067);
    expect(t.acres).toBeCloseTo(6.013);
    expect(t.icpText).toContain("MEDICAL RESORT");
    // Parcel mirrors fetchParcelAtPoint's Harris shape, so the score's
    // owner-change signal reads last_sale_date with no extra plumbing.
    expect(t.parcel.county).toBe("Harris");
    expect(t.parcel.last_sale_date).toBe("2025-12-30");
    expect(t.parcel.owner_mailing_address).toBe(
      "6060 RICHMOND AVENUE STE 380, HOUSTON, TX 77057-6224"
    );
    expect(isRecentOwnerChange(t.parcel.last_sale_date, new Date("2026-07-08"))).toBe(true);
  });

  it("rejects features missing geometry, owner, address, or date", () => {
    expect(normalizeTransfer({ properties: FIXTURE.properties })).toBeNull();
    expect(
      normalizeTransfer({ ...FIXTURE, properties: { ...FIXTURE.properties, owner_name_1: "" } })
    ).toBeNull();
    expect(
      normalizeTransfer({ ...FIXTURE, properties: { ...FIXTURE.properties, new_owner_date: null } })
    ).toBeNull();
  });

  it("notes carry the dossier's Owner: sentence but no construction timeline", () => {
    const notes = transferNotes({
      saleDateIso: "2025-12-30",
      owner: "HERITAGE PARK MANAGEMENT LLC",
      marketValue: 16119067,
      acres: 6.013,
    });
    // The buyer job sheet extracts the owner via this exact pattern.
    expect(notes.match(/Owner: ([^.]+)\./)?.[1]).toBe("HERITAGE PARK MANAGEMENT LLC");
    // An existing building has no construction timeline: the timing signal
    // must stay N/A, so the notes must never parse as a completion estimate.
    expect(estimateCompletionFromNotes(notes)).toBeNull();
    // Operator-only provenance, keyed for the property page's origin line.
    expect(notes).toMatch(/^HCAD transfer 2025-12-30/);
  });
});
