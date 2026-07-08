import { describe, expect, it } from "vitest";
import {
  evaluateFreeClaim,
  FREE_CLEARANCE_DAYS,
  FREE_MIN_AGE_DAYS,
  FREE_MIN_OPEN_SPOTS,
  leadRank,
  quantile,
} from "./allocation";

const ctx = (over?: Partial<{ openValues: number[]; openSpots: number }>) => ({
  openValues: [8000, 12000, 18000, 30000, 45000],
  openSpots: 12,
  ...over,
});
const lead = (over?: Partial<Parameters<typeof evaluateFreeClaim>[0]>) => ({
  annualHi: 12000,
  ageDays: 7,
  freeUnlocksOnLead: 0,
  spotsLeft: 3,
  ...over,
});

describe("leads/allocation — free-claim policy", () => {
  it("allows a mid-shelf lead with healthy inventory", () => {
    expect(evaluateFreeClaim(lead(), ctx()).allowed).toBe(true);
  });

  it("never over-spends the per-lead free budget (paid capacity preserved)", () => {
    const v = evaluateFreeClaim(lead({ freeUnlocksOnLead: 1 }), ctx());
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/free spot.*already claimed/i);
  });

  it("gives fresh jobs a paid-only first look", () => {
    expect(evaluateFreeClaim(lead({ ageDays: FREE_MIN_AGE_DAYS - 1 }), ctx()).allowed).toBe(false);
    expect(evaluateFreeClaim(lead({ ageDays: FREE_MIN_AGE_DAYS }), ctx()).allowed).toBe(true);
  });

  it("protects the top quartile of the shelf (the headline job sells the market)", () => {
    // 75th percentile of ctx values = 30000 -> a 45k job is protected...
    expect(evaluateFreeClaim(lead({ annualHi: 45000 }), ctx()).allowed).toBe(false);
    // ...but the same job clears out after the clearance window.
    expect(
      evaluateFreeClaim(lead({ annualHi: 45000, ageDays: FREE_CLEARANCE_DAYS }), ctx()).allowed
    ).toBe(true);
  });

  it("uses the absolute floor when inventory is too thin to rank", () => {
    const thin = ctx({ openValues: [45000, 12000] });
    expect(evaluateFreeClaim(lead({ annualHi: 45000 }), thin).allowed).toBe(false);
    expect(evaluateFreeClaim(lead({ annualHi: 12000 }), thin).allowed).toBe(true);
  });

  it("pauses all free claims when open spots run low", () => {
    const v = evaluateFreeClaim(lead(), ctx({ openSpots: FREE_MIN_OPEN_SPOTS - 1 }));
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/inventory is tight/i);
  });

  it("sold-out leads are never claimable", () => {
    expect(evaluateFreeClaim(lead({ spotsLeft: 0 }), ctx()).allowed).toBe(false);
  });

  it("clearance overrides value protection AND tight inventory", () => {
    const v = evaluateFreeClaim(
      lead({ annualHi: 45000, ageDays: FREE_CLEARANCE_DAYS + 5 }),
      ctx({ openSpots: 2 })
    );
    expect(v.allowed).toBe(true);
    expect(v.reason).toMatch(/aging/i);
  });

  it("quantile interpolates and survives empty input", () => {
    expect(quantile([], 0.75)).toBe(0);
    expect(quantile([10], 0.75)).toBe(10);
    expect(quantile([0, 100], 0.5)).toBe(50);
  });

  it("leadRank is universal: value x bid window, no buyer factors", () => {
    // Value dominates…
    expect(leadRank(40000, null)).toBeGreaterThan(leadRank(12000, null));
    // …an open bid window boosts (3 months out beats no-timeline at equal value)…
    expect(leadRank(20000, 3)).toBeGreaterThan(leadRank(20000, null));
    // …a long-settled contract drags below an always-biddable existing property…
    expect(leadRank(20000, -24)).toBeLessThan(leadRank(20000, null));
    // …and the window can promote a smaller urgent job over a bigger far-out one.
    expect(leadRank(20000, 2)).toBeGreaterThan(leadRank(28000, 18));
    // Unsized leads price standard, so they rank at a modest default — not 0.
    expect(leadRank(null, 3)).toBe(8000 * 1.3);
    expect(leadRank(null, 3)).toBeLessThan(leadRank(12000, 3));
  });
});
