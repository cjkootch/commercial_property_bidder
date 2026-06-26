import { describe, expect, it } from "vitest";
import {
  computeLeadScore,
  isRecentOwnerChange,
  isGrassQualified,
  haversineMiles,
} from "./criteria";

describe("sourcing/criteria", () => {
  it("grass qualification gates on the threshold", () => {
    expect(isGrassQualified(0.4)).toBe(true);
    expect(isGrassQualified(0.34)).toBe(false);
    expect(isGrassQualified(null)).toBe(false);
  });

  it("recent owner change is windowed and null-safe", () => {
    const asOf = new Date("2026-06-01");
    expect(isRecentOwnerChange("2025-06-01", asOf)).toBe(true); // 12 mo
    expect(isRecentOwnerChange("2023-01-01", asOf)).toBe(false); // ~41 mo
    expect(isRecentOwnerChange(null, asOf)).toBe(false);
  });

  it("haversine ~ known distance (Houston ~ 0 to itself, scale sane)", () => {
    expect(haversineMiles([-95.6, 30.0], [-95.6, 30.0])).toBeCloseTo(0, 5);
    // ~1 degree lat ≈ 69 miles
    expect(haversineMiles([-95.6, 30.0], [-95.6, 31.0])).toBeGreaterThan(68);
    expect(haversineMiles([-95.6, 30.0], [-95.6, 31.0])).toBeLessThan(70);
  });

  it("lead score rewards stacked signals and is capped at 100", () => {
    const strong = computeLeadScore({
      grassFraction: 0.7,
      recentOwnerChange: true,
      activelyLeasing: true,
      grossMarginPct: 0.45,
      neighborsNearby: 5,
    });
    expect(strong.score).toBe(100); // 30 + 25 + 20 + 15 + 10
    expect(strong.reasons).toContain("recent owner change");

    const weak = computeLeadScore({
      grassFraction: 0,
      recentOwnerChange: false,
      activelyLeasing: false,
      grossMarginPct: null,
      neighborsNearby: 0,
    });
    expect(weak.score).toBe(0);
    expect(weak.reasons).toEqual([]);
  });

  it("lead score components are weighted as documented", () => {
    const onlyOwner = computeLeadScore({
      grassFraction: 0,
      recentOwnerChange: true,
      activelyLeasing: false,
      grossMarginPct: null,
      neighborsNearby: 0,
    });
    expect(onlyOwner.score).toBe(25);
  });
});
