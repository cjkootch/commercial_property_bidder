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
    // No timeline -> normalized over 80 pts, so owner-change alone = 20/80 = 25.
    const onlyOwner = computeLeadScore({
      grassFraction: 0,
      recentOwnerChange: true,
      activelyLeasing: false,
      grossMarginPct: null,
      neighborsNearby: 0,
    });
    expect(onlyOwner.score).toBe(25);
  });

  it("timing/urgency peaks in the 1-6 month bid window and decays after completion", () => {
    const base = {
      grassFraction: 0,
      recentOwnerChange: false,
      activelyLeasing: false,
      grossMarginPct: null,
      neighborsNearby: 0,
    };
    const at = (m: number | null) => computeLeadScore({ ...base, monthsToCompletion: m });

    expect(at(3).score).toBe(20); // sweet spot: 20/100
    expect(at(3).reasons).toContain("urgent bid window");
    expect(at(0).score).toBe(18); // completing now
    expect(at(8).score).toBe(12); // get on the bidder list
    expect(at(18).score).toBe(6); // far out
    expect(at(-4).score).toBe(10); // recently completed
    expect(at(-24).score).toBe(2); // long done
    // No timeline: the part reports N/A and doesn't drag the score down.
    const na = at(null);
    expect(na.score).toBe(0);
    expect(na.parts.find((p) => p.label === "Timing / urgency")?.max).toBe(0);
  });

  it("a fully-stacked construction lead still caps at 100", () => {
    const strong = computeLeadScore({
      grassFraction: 0.7,
      recentOwnerChange: true,
      activelyLeasing: true,
      grossMarginPct: 0.45,
      neighborsNearby: 5,
      monthsToCompletion: 3,
    });
    expect(strong.score).toBe(100);
  });
});
