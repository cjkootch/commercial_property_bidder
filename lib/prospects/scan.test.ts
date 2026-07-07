import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { priceProspect } from "./scan";
import { computePricing } from "../pricing/engine";
import { DEFAULT_PRICING_CONFIG } from "../pricing/config";

describe("priceProspect", () => {
  const m = { turf_sqft: 35000, bed_sqft: 1500, complexity: 1.0, confidence: "High" as const };

  it("matches the pricing engine's headline figures", () => {
    const engine = computePricing(m, DEFAULT_PRICING_CONFIG);
    const p = priceProspect(m, DEFAULT_PRICING_CONFIG);
    expect(p.price_per_visit).toBe(engine.price_per_visit);
    expect(p.monthly_price).toBe(engine.monthly_price);
    expect(p.annual_price).toBe(engine.annual_price);
  });

  it("brackets the annual price with a lo–hi estimate band", () => {
    const p = priceProspect(m, DEFAULT_PRICING_CONFIG);
    expect(p.estimate_lo).toBeLessThan(p.annual_price);
    expect(p.estimate_hi).toBeGreaterThan(p.annual_price);
    expect(p.estimate_lo).toBe(Math.round(p.annual_price * 0.9));
    expect(p.estimate_hi).toBe(Math.round(p.annual_price * 1.15));
  });
});

// Training-isolation guarantee (enforced by construction): the self-serve
// prospecting code must never write buyer geometry to the operator tables the ML
// export reads (`measurement`/`pricing_result`). If someone later wires a
// prospect save through the operator seam, this fails.
describe("prospect data never enters the ML training pipeline", () => {
  const files = [
    "app/buyers/prospects/actions.ts",
    "lib/prospects/scan.ts",
    "lib/prospects/postcard.ts",
  ];
  const forbidden = ["persistMeasurementAndPrice", "pricingResult", "insert(measurement"];

  for (const f of files) {
    it(`${f} does not write to measurement/pricing_result`, () => {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      for (const bad of forbidden) {
        expect(src.includes(bad), `${f} must not reference ${bad}`).toBe(false);
      }
    });
  }
});
