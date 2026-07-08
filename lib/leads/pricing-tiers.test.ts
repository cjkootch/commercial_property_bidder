import { describe, expect, it } from "vitest";
import { leadTierFor, PREMIUM_MIN_ANNUAL_HI, VALUE_MAX_ANNUAL_HI } from "./pricing-tiers";

describe("leads/pricing-tiers", () => {
  it("tiers by the teaser's contract-value ceiling", () => {
    expect(leadTierFor(131_500).tier).toBe("premium");
    expect(leadTierFor(PREMIUM_MIN_ANNUAL_HI).tier).toBe("premium");
    expect(leadTierFor(15_000).tier).toBe("standard");
    expect(leadTierFor(VALUE_MAX_ANNUAL_HI).tier).toBe("standard");
    expect(leadTierFor(5_200).tier).toBe("value");
  });

  it("unsized leads price at the standard anchor", () => {
    expect(leadTierFor(null).tier).toBe("standard");
    expect(leadTierFor(undefined).tier).toBe("standard");
    expect(leadTierFor(0).tier).toBe("standard");
  });

  it("prices order sensibly and defaults are set", () => {
    const p = leadTierFor(50_000);
    const s = leadTierFor(15_000);
    const v = leadTierFor(5_000);
    expect(p.price_cents).toBeGreaterThan(s.price_cents);
    expect(s.price_cents).toBeGreaterThan(v.price_cents);
    expect(p.exclusive_cents).toBeGreaterThan(s.exclusive_cents);
    expect(s.exclusive_cents).toBeGreaterThan(v.exclusive_cents);
    // exclusive is always the bigger commitment within a tier
    for (const t of [p, s, v]) expect(t.exclusive_cents).toBeGreaterThan(t.price_cents);
  });
});
