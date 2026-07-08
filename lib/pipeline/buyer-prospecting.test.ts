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
  notes: "Ownership transfer: HCAD transfer 2026-06-30. Owner: ACME HOLDINGS LLC.",
  spotsLeft: 3,
  verified: false,
};

describe("pipeline/buyer-prospecting", () => {
  it("reads as a lead handoff: specifics up top, real date, teaser-safe", () => {
    const m = buildProspectMessage({
      company: "Westco Grounds Maintenance",
      lead: pitch,
      distanceMi: 12.4,
      brand: "Greenkeep",
      replyEmail: "leads@greenkeep.us",
      price: 89,
      cap: 3,
      claimUrl: "https://greenkeep.us/buyers/claim/tok123",
    });
    expect(m.subject).toBe("Grounds contract lead — new owner, Spring area — est. $14,900–$22,300/yr");
    // The deal-memo block, with the REAL sale date from the notes.
    expect(m.body).toContain("A lead for you. No charge on this one, no obligation");
    // The scarcity rule is stated up front — urgency is the mechanism, honestly.
    expect(m.body).toContain("we only ever sell a job to 3 companies");
    expect(m.body).toContain("TRIGGER — Property changed owners on 2026-06-30");
    expect(m.body).toContain("GROUNDS — ~177,118 sq ft of maintainable turf, measured from the air");
    expect(m.body).toContain("EST. VALUE — $14,900–$22,300/yr at market rates, recurring");
    expect(m.body).toContain("STATUS — 3 of 3 spots left — when they're gone, this job closes for good");
    expect(m.body).toContain("https://greenkeep.us/buyers/claim/tok123");
    // Teaser-safe: no address, no owner name in the email.
    expect(m.body).not.toContain("ACME HOLDINGS");
    // Scarcity + terms conventions hold.
    expect(m.body).toContain("capped at 3 companies*");
    expect(m.body).toContain("/terms");
    // Honest outreach: signed as us, never impersonating a customer.
    expect(m.body).toContain("We're Greenkeep");
    expect(m.body).toContain("— Greenkeep");
  });

  it("hand-verified measurements say so — it sells", () => {
    const m = buildProspectMessage({
      company: "X",
      lead: { ...pitch, verified: true },
      distanceMi: null,
      brand: "G",
      replyEmail: "",
      price: 89,
      cap: 3,
      claimUrl: "https://x",
    });
    expect(m.body).toContain("hand-verified measurement");
  });

  it("frames each kind's trigger with its own date", () => {
    const at = (kind: "opening" | "construction" | "violation", notes: string) =>
      buildProspectMessage({
        company: "X",
        lead: { ...pitch, kind, notes },
        distanceMi: null,
        brand: "G",
        replyEmail: "",
        price: 89,
        cap: 3,
        claimUrl: "https://x",
      }).body;
    expect(at("opening", "Opens 2026-09-01.")).toContain(
      "TRIGGER — New business opening around 2026-09-01"
    );
    expect(at("violation", "311 case 26001 (2026-07-03): cited.")).toContain(
      "TRIGGER — Cited by the city on 2026-07-03"
    );
    expect(at("construction", "TABS 1: office, est. cost $2,000,000, Est. start 2026-08-15.")).toContain(
      "TRIGGER — New construction, breaks ground around 2026-08-15"
    );
  });

  it("toPitch requires a priced teaser and coordinates, and carries the memo fields", () => {
    const base = {
      p: { id: "x", lat: 30, lng: -95, city: "Spring", notes: "n" },
      kind: "construction",
      spotsLeft: 2,
      teaser: { annual_lo: 5000, annual_hi: 7500, turf_sqft: 40000, verified: true },
    } as unknown as MarketLead;
    const p = toPitch(base);
    expect(p?.annualHi).toBe(7500);
    expect(p?.spotsLeft).toBe(2);
    expect(p?.verified).toBe(true);
    expect(p?.notes).toBe("n");
    expect(toPitch({ ...base, teaser: null } as MarketLead)).toBeNull();
    expect(
      toPitch({ ...base, p: { ...base.p, lat: null } } as unknown as MarketLead)
    ).toBeNull();
  });
});
