import { describe, expect, it } from "vitest";
import { keepRfp, rfpNotes, type RfpRow } from "./rfps";
import { leadKind, displayName } from "../leads/market";

const ROW: RfpRow = {
  portal: "harriscountytx",
  agency: "Harris County",
  city: "Houston",
  projectId: "234315",
  referenceId: "26/0187",
  title: "ITB - Mowing and Maintenance Services of Right-Of-Ways and Esplanades at Hardy Aldine Camp",
  closesIso: "2026-08-04",
  url: "https://harriscountytx.bonfirehub.com/opportunities/234315",
};

describe("pipeline/rfps", () => {
  it("keyword filter keeps grounds solicitations and drops the rest", () => {
    expect(keepRfp("ITB - Mowing and Maintenance Services of Right-Of-Ways")).toBe(true);
    expect(keepRfp("RFQ - Landscape Services for Various Clinics")).toBe(true);
    expect(keepRfp("ITB - Turf Establishment, Vegetation Promotion")).toBe(true);
    expect(keepRfp("ITB - Intelligence Analyst Officer for the TAG Center")).toBe(false);
    expect(keepRfp("CSP - Construction Manager at Risk")).toBe(false);
    // Professional services (design, not doing) are not a bid our buyers can win.
    expect(keepRfp("RFSQ - Professional Landscape Architectural and Engineering Services")).toBe(false);
  });

  it("notes carry the deadline (rank + expiry read it) and the solicitation link", () => {
    const notes = rfpNotes(ROW);
    expect(notes.match(/Bids close (\d{4}-\d{2}-\d{2})/)?.[1]).toBe("2026-08-04");
    expect(notes).toContain("https://harriscountytx.bonfirehub.com/opportunities/234315");
    expect(notes.match(/Owner: ([^.]+)\./)?.[1]).toBe("Harris County");
  });

  it("RFP refs get the rfp kind and strip from display names", () => {
    const name = `${ROW.title.slice(0, 120)} (RFP harriscountytx-234315)`;
    expect(leadKind(name)).toBe("rfp");
    expect(displayName(name)).toBe(ROW.title.slice(0, 120));
  });
});
