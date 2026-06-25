import { describe, expect, it } from "vitest";
import { computePricing } from "./engine";
import { DEFAULT_PRICING_CONFIG } from "./config";
import type { PricingMeasurement } from "./types";

// Build spec section 5.3 fixtures. These must reproduce the spreadsheet to 2
// decimals using the default config. Do not change the engine without
// re-confirming these.
describe("computePricing — section 5.3 fixtures (default config)", () => {
  const fixtures: Array<{
    name: string;
    measurement: PricingMeasurement;
    price_per_visit: number;
    monthly: number;
    margin: number;
    cole_cut_yr: number;
    needs_review: boolean;
    expectedFlag?: keyof ReturnType<typeof computePricing>["flags"];
  }> = [
    {
      name: "Self-storage",
      measurement: { turf_sqft: 35000, bed_sqft: 1500, complexity: 1.0, confidence: "High" },
      price_per_visit: 150.75,
      monthly: 502.51,
      margin: 0.4,
      cole_cut_yr: 1206.03,
      needs_review: false,
    },
    {
      name: "Office park",
      measurement: { turf_sqft: 18000, bed_sqft: 4000, complexity: 1.2, confidence: "High" },
      price_per_visit: 154.78,
      monthly: 515.94,
      margin: 0.4,
      cole_cut_yr: 1238.25,
      needs_review: true,
      expectedFlag: "bed_heavy",
    },
    {
      // NOTE: the build-spec MD table lists 284.04 / 946.79 / 2272.27 for the
      // church, but the actual spreadsheet (BATCH PIPELINE row 6 — the real
      // source of truth, which the spec says we must reproduce exactly) computes
      // 284.0331 / 946.7769 / 2272.2645. The MD values are rounding typos. We
      // assert the spreadsheet's values.
      name: "Church",
      measurement: { turf_sqft: 90000, bed_sqft: 2000, complexity: 1.0, confidence: "Med" },
      price_per_visit: 284.03,
      monthly: 946.78,
      margin: 0.4,
      cole_cut_yr: 2272.26,
      needs_review: false,
    },
  ];

  for (const f of fixtures) {
    describe(f.name, () => {
      const r = computePricing(f.measurement, DEFAULT_PRICING_CONFIG);

      it("price per visit", () => expect(r.price_per_visit).toBeCloseTo(f.price_per_visit, 2));
      it("monthly price", () => expect(r.monthly_price).toBeCloseTo(f.monthly, 2));
      it("gross margin", () => expect(r.gross_margin_pct).toBeCloseTo(f.margin, 2));
      it("cole annual cut", () => expect(r.cole_annual_cut).toBeCloseTo(f.cole_cut_yr, 2));
      it("needs_review", () => expect(r.needs_review).toBe(f.needs_review));

      if (f.expectedFlag) {
        it(`flag ${f.expectedFlag} fires`, () =>
          expect(r.flags[f.expectedFlag!]).toBe(true));
      }
    });
  }

  it("self-storage under 1 acre does NOT fire market flags despite high $/acre", () => {
    const r = computePricing(fixtures[0].measurement, DEFAULT_PRICING_CONFIG);
    expect(r.turf_acres).toBeLessThan(1);
    expect(r.implied_per_acre_visit).toBeGreaterThan(150); // ~187
    expect(r.flags.below_market).toBe(false);
    expect(r.flags.above_market).toBe(false);
  });
});

describe("computePricing — edge cases", () => {
  it("zero turf yields null implied_per_acre_visit and floors the price", () => {
    const r = computePricing(
      { turf_sqft: 0, bed_sqft: 0, confidence: "High" },
      DEFAULT_PRICING_CONFIG
    );
    expect(r.implied_per_acre_visit).toBeNull();
    // fixed + drive = 20 crew-min -> 0.333h * 96 = 32 cost; price floored to 70
    expect(r.price_per_visit).toBe(DEFAULT_PRICING_CONFIG.min_price_per_visit);
    expect(r.flags.bed_heavy).toBe(false); // guarded against divide-by-zero
  });

  it("complexity defaults to 1.0 when omitted", () => {
    const withDefault = computePricing(
      { turf_sqft: 35000, bed_sqft: 1500, confidence: "High" },
      DEFAULT_PRICING_CONFIG
    );
    const explicit = computePricing(
      { turf_sqft: 35000, bed_sqft: 1500, complexity: 1.0, confidence: "High" },
      DEFAULT_PRICING_CONFIG
    );
    expect(withDefault.price_per_visit).toBe(explicit.price_per_visit);
  });

  it("Low confidence sets needs_review", () => {
    const r = computePricing(
      { turf_sqft: 35000, bed_sqft: 1500, confidence: "Low" },
      DEFAULT_PRICING_CONFIG
    );
    expect(r.flags.low_confidence).toBe(true);
    expect(r.needs_review).toBe(true);
  });
});

describe("computePricing — breakdown option", () => {
  const m = { turf_sqft: 35000, bed_sqft: 1500, complexity: 1.0, confidence: "High" } as const;

  it("omits breakdown by default", () => {
    const r = computePricing(m, DEFAULT_PRICING_CONFIG);
    expect(r.breakdown).toBeUndefined();
  });

  it("attaches consistent intermediate values when requested", () => {
    const r = computePricing(m, DEFAULT_PRICING_CONFIG, { breakdown: true });
    const b = r.breakdown!;
    expect(b).toBeDefined();
    // Chain reconciles with the returned headline figures.
    expect(b.turf_acres).toBeCloseTo(35000 / 43560, 6);
    expect(b.total_crew_min).toBeCloseTo(
      b.turf_time + b.bed_time + b.fixed_min_per_stop + b.drive_min_per_stop,
      6
    );
    expect(b.crew_hours_per_visit).toBeCloseTo(b.total_crew_min / 60, 6);
    expect(b.cost_per_visit).toBeCloseTo(r.cost_per_visit, 6);
    expect(b.crew_cost_per_hour).toBe(96);
    expect(b.price_floored).toBe(false);
  });

  it("flags the floor when the per-visit minimum binds (tiny lot)", () => {
    const r = computePricing(
      { turf_sqft: 0, bed_sqft: 0, confidence: "High" },
      DEFAULT_PRICING_CONFIG,
      { breakdown: true }
    );
    expect(r.breakdown!.price_floored).toBe(true);
  });
});
