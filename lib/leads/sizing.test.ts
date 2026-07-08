import { describe, expect, it } from "vitest";
import { sizeLeadFromMeasurement } from "./sizing";
import { computePricing } from "../pricing/engine";
import { DEFAULT_PRICING_CONFIG } from "../pricing/config";

describe("leads/sizing — operator-verified sizing", () => {
  const meas = { turf_sqft: 35_000, bed_sqft: 1_500, complexity: 1.0, confidence: "High" as const };
  const parcelSqft = 87_120; // 2 acres

  it("is verified, never projected, and uses the measured turf verbatim", () => {
    const s = sizeLeadFromMeasurement(meas, parcelSqft, DEFAULT_PRICING_CONFIG);
    expect(s.verified).toBe(true);
    expect(s.projected).toBe(false);
    expect(s.turf_sqft).toBe(35_000);
    expect(s.acres).toBeCloseTo(2, 5);
  });

  it("hand-measured numbers get a tighter value band than the estimate (±10% vs ±20%)", () => {
    const s = sizeLeadFromMeasurement(meas, parcelSqft, DEFAULT_PRICING_CONFIG);
    const annual = computePricing(meas, DEFAULT_PRICING_CONFIG).annual_price;
    expect(s.annual_lo).toBeGreaterThanOrEqual(Math.floor(annual * 0.9 - 100));
    expect(s.annual_hi).toBeLessThanOrEqual(Math.ceil(annual * 1.1 + 100));
    // Band is meaningfully tighter than the estimate's ±20%.
    expect(s.annual_hi - s.annual_lo).toBeLessThan(annual * 0.4);
  });

  it("prices exactly what the engine prices — one engine, every surface", () => {
    const s = sizeLeadFromMeasurement(meas, parcelSqft, DEFAULT_PRICING_CONFIG);
    const priced = computePricing(meas, DEFAULT_PRICING_CONFIG);
    expect(s.monthly).toBe(priced.monthly_price);
    expect(s.crew_hours_per_visit).toBe(priced.crew_hours_per_visit);
  });
});
