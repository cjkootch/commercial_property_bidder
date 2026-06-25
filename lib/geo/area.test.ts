import { describe, expect, it } from "vitest";
import area from "@turf/area";
import { M2_TO_SQFT, sqftFromM2, sumByKind, isAreaKind, normalizeKind } from "./area";
import type { ServiceAreaCollection } from "./types";

function feat(kind: string, area_sqft: number): ServiceAreaCollection["features"][number] {
  return {
    type: "Feature",
    properties: { kind: kind as never, area_sqft },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
  };
}

describe("geo/area", () => {
  it("converts m² to sqft", () => {
    expect(sqftFromM2(1)).toBeCloseTo(M2_TO_SQFT, 6);
    expect(sqftFromM2(100)).toBeCloseTo(1076.39, 1);
  });

  it("computes a known polygon area accurately (@turf/area pipeline)", () => {
    // ~100m x 100m box near the equator (lng 0) -> ~10,000 m² -> ~107,639 sf.
    // 100m ≈ 0.000898315° lat; at lat 0, 1° lng ≈ 111,320 m so use matching dx.
    const dLat = 0.000898315; // 100 m
    const dLng = 0.000898315; // ~100 m at the equator
    const poly = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [[[0, 0], [dLng, 0], [dLng, dLat], [0, dLat], [0, 0]]],
      },
    } as GeoJSON.Feature;
    const sqft = sqftFromM2(area(poly));
    // Within 1% of 107,639 sf (small spherical/projection variance).
    expect(sqft).toBeGreaterThan(107639 * 0.99);
    expect(sqft).toBeLessThan(107639 * 1.01);
  });

  it("sums areas by category; only turf+bed are service areas", () => {
    const fc: ServiceAreaCollection = {
      type: "FeatureCollection",
      features: [
        feat("turf", 1000),
        feat("turf", 500),
        feat("bed", 250),
        feat("building", 800),
        feat("parking", 1200),
        feat("sidewalk", 100),
        feat("other", 50),
      ],
    };
    const t = sumByKind(fc);
    expect(t.turf_sqft).toBe(1500);
    expect(t.bed_sqft).toBe(250);
    expect(t.byKind.building).toBe(800);
    expect(t.byKind.parking).toBe(1200);
    expect(t.nonservice_sqft).toBe(800 + 1200 + 100 + 50);
  });

  it("normalizes legacy 'exclude' kind to 'other'", () => {
    expect(normalizeKind("exclude")).toBe("other");
    const t = sumByKind({ type: "FeatureCollection", features: [feat("exclude", 300)] });
    expect(t.byKind.other).toBe(300);
    expect(t.nonservice_sqft).toBe(300);
  });

  it("handles empty / null input", () => {
    const t = sumByKind(null);
    expect(t.turf_sqft).toBe(0);
    expect(t.nonservice_sqft).toBe(0);
  });

  it("validates area kinds", () => {
    expect(isAreaKind("turf")).toBe(true);
    expect(isAreaKind("building")).toBe(true);
    expect(isAreaKind("nonsense")).toBe(false);
  });
});
