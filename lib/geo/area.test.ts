import { describe, expect, it } from "vitest";
import { M2_TO_SQFT, sqftFromM2, sumByKind, isAreaKind } from "./area";
import type { ServiceAreaCollection } from "./types";

function feat(kind: string, area_sqft: number): ServiceAreaCollection["features"][number] {
  return {
    type: "Feature",
    properties: { kind: kind as "turf" | "bed" | "exclude", area_sqft },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
  };
}

describe("geo/area", () => {
  it("converts m² to sqft", () => {
    expect(sqftFromM2(1)).toBeCloseTo(M2_TO_SQFT, 6);
    expect(sqftFromM2(100)).toBeCloseTo(1076.39, 1);
  });

  it("sums areas by kind", () => {
    const fc: ServiceAreaCollection = {
      type: "FeatureCollection",
      features: [feat("turf", 1000), feat("turf", 500), feat("bed", 250), feat("exclude", 999)],
    };
    const t = sumByKind(fc);
    expect(t.turf_sqft).toBe(1500);
    expect(t.bed_sqft).toBe(250);
    expect(t.exclude_sqft).toBe(999); // tracked but not folded into turf/bed
  });

  it("handles empty / null input", () => {
    expect(sumByKind(null)).toEqual({ turf_sqft: 0, bed_sqft: 0, exclude_sqft: 0 });
    expect(sumByKind({ type: "FeatureCollection", features: [] })).toEqual({
      turf_sqft: 0,
      bed_sqft: 0,
      exclude_sqft: 0,
    });
  });

  it("validates area kinds", () => {
    expect(isAreaKind("turf")).toBe(true);
    expect(isAreaKind("parking")).toBe(false);
  });
});
