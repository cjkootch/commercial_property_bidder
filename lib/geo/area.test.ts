import { describe, expect, it } from "vitest";
import area from "@turf/area";
import {
  M2_TO_SQFT,
  sqftFromM2,
  sumByKind,
  isAreaKind,
  normalizeKind,
  computeEffectiveTurf,
} from "./area";
import type { ServiceAreaCollection } from "./types";

function feat(kind: string, area_sqft: number): ServiceAreaCollection["features"][number] {
  return {
    type: "Feature",
    properties: { kind: kind as never, area_sqft },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
  };
}

// A square polygon over [x0,x0+s] x [y0,y0+s] (lng/lat degrees).
function box(kind: string, x0: number, y0: number, s: number): ServiceAreaCollection["features"][number] {
  return {
    type: "Feature",
    properties: { kind: kind as never, area_sqft: 0 },
    geometry: {
      type: "Polygon",
      coordinates: [[[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]]],
    },
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

  it("sums areas by category; legacy parking/sidewalk fold into pavement", () => {
    const fc: ServiceAreaCollection = {
      type: "FeatureCollection",
      features: [
        feat("turf", 1000),
        feat("turf", 500),
        feat("bed", 250),
        feat("building", 800),
        feat("parking", 1200), // legacy -> pavement
        feat("sidewalk", 100), // legacy -> pavement
        feat("other", 50),
      ],
    };
    const t = sumByKind(fc);
    expect(t.turf_sqft).toBe(1500);
    expect(t.bed_sqft).toBe(250);
    expect(t.byKind.building).toBe(800);
    expect(t.byKind.pavement).toBe(1300); // 1200 + 100 merged
    expect(t.nonservice_sqft).toBe(800 + 1300 + 50);
  });

  it("normalizes legacy kinds", () => {
    expect(normalizeKind("exclude")).toBe("other");
    expect(normalizeKind("parking")).toBe("pavement");
    expect(normalizeKind("sidewalk")).toBe("pavement");
  });

  it("computeEffectiveTurf subtracts overlapping building/pavement from turf", () => {
    // 3x3 turf with a 1x1 building and a 1x1 pavement inside -> 9 - 1 - 1 = 7 units².
    const fc: ServiceAreaCollection = {
      type: "FeatureCollection",
      features: [
        box("turf", 0, 0, 3),
        box("building", 0, 0, 1),
        box("pavement", 2, 2, 1),
      ],
    };
    const full = sqftFromM2(
      area({
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [[[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]]] },
      } as GeoJSON.Feature)
    );
    const mowable = computeEffectiveTurf(fc, false);
    // ~7/9 of the full turf (small spherical variance).
    expect(mowable / full).toBeGreaterThan(0.74);
    expect(mowable / full).toBeLessThan(0.79);
  });

  it("computeEffectiveTurf keeps tree area when grass-under-trees is on", () => {
    const fc: ServiceAreaCollection = {
      type: "FeatureCollection",
      features: [box("turf", 0, 0, 3), box("tree", 0, 0, 1)],
    };
    const withGrass = computeEffectiveTurf(fc, true);
    const withoutGrass = computeEffectiveTurf(fc, false);
    expect(withGrass).toBeGreaterThan(withoutGrass);
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
