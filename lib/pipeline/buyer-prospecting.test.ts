import { describe, expect, it } from "vitest";
import { buildProspectMessage, toPitch } from "./buyer-prospecting";
import type { MarketLead } from "../leads/market";

const pitch = {
  id: "p1",
  kind: "transfer" as const,
  city: "Spring",
  lat: 30.05,
  lng: -95.5,
  annualLo: 14900,
  annualHi: 22300,
  turf: 177118,
};

describe("pipeline/buyer-prospecting", () => {
  it("builds a kind-aware, honest pitch with the claim link", () => {
    const m = buildProspectMessage({
      company: "Westco Grounds Maintenance",
      lead: pitch,
      distanceMi: 12.4,
      brand: "Greenkeep",
      replyEmail: "ops@greenkeep.us",
      price: 79,
      cap: 3,
      claimUrl: "https://greenkeep.us/buyers/claim/tok123",
    });
    expect(m.subject).toBe("$22,300/yr grounds contract, 12 mi from your office");
    expect(m.body).toContain("just changed owners");
    expect(m.body).toContain("~177,118 sq ft");
    expect(m.body).toContain("capped at 3 landscaping companies");
    expect(m.body).toContain("https://greenkeep.us/buyers/claim/tok123");
    // Honest outreach: signed as us, never impersonating a customer.
    expect(m.body).toContain("— Greenkeep");
  });

  it("frames openings and construction differently", () => {
    const at = (kind: "opening" | "construction") =>
      buildProspectMessage({
        company: "X",
        lead: { ...pitch, kind },
        distanceMi: null,
        brand: "G",
        replyEmail: "",
        price: 79,
        cap: 3,
        claimUrl: "https://x",
      }).body;
    expect(at("opening")).toContain("new business is opening");
    expect(at("construction")).toContain("breaks ground");
    // Unknown office -> honest "near you" phrasing, no fake mileage.
    expect(at("opening")).toContain("in your service area");
  });

  it("toPitch requires a priced teaser and coordinates", () => {
    const base = {
      p: { id: "x", lat: 30, lng: -95, city: "Spring" },
      kind: "construction",
      teaser: { annual_lo: 5000, annual_hi: 7500, turf_sqft: 40000 },
    } as unknown as MarketLead;
    expect(toPitch(base)?.annualHi).toBe(7500);
    expect(toPitch({ ...base, teaser: null } as MarketLead)).toBeNull();
    expect(
      toPitch({ ...base, p: { ...base.p, lat: null } } as unknown as MarketLead)
    ).toBeNull();
  });
});
