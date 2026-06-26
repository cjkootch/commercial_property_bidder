import { describe, expect, it } from "vitest";
import { rasterizeMask, classPixelCounts, CLASS_INDEX } from "./raster";
import type { ServiceAreaCollection } from "./types";

// A 10x10 tile over the unit square [0,1]x[0,1].
const bounds = { minLng: 0, minLat: 0, maxLng: 1, maxLat: 1, width: 10, height: 10 };

function poly(kind: string, coords: number[][]): ServiceAreaCollection["features"][number] {
  return {
    type: "Feature",
    properties: { kind: kind as never, area_sqft: 0 },
    geometry: { type: "Polygon", coordinates: [coords] },
  };
}

describe("geo/raster", () => {
  it("paints a turf polygon over the left half", () => {
    const fc: ServiceAreaCollection = {
      type: "FeatureCollection",
      features: [poly("turf", [[0, 0], [0.5, 0], [0.5, 1], [0, 1], [0, 0]])],
    };
    const mask = rasterizeMask(fc, bounds);
    const counts = classPixelCounts(mask);
    expect(counts[CLASS_INDEX.turf]).toBe(50); // left 5 columns x 10 rows
    expect(counts[0]).toBe(50); // background right half
  });

  it("building painted over turf wins on overlap", () => {
    const fc: ServiceAreaCollection = {
      type: "FeatureCollection",
      features: [
        poly("turf", [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]), // whole tile
        poly("building", [[0, 0], [0.5, 0], [0.5, 1], [0, 1], [0, 0]]), // left half
      ],
    };
    const counts = classPixelCounts(rasterizeMask(fc, bounds));
    expect(counts[CLASS_INDEX.building]).toBe(50);
    expect(counts[CLASS_INDEX.turf]).toBe(50);
    expect(counts[0]).toBe(0);
  });

  it("turf wins over a pavement dropped on top (grass median in a parking lot)", () => {
    const fc: ServiceAreaCollection = {
      type: "FeatureCollection",
      features: [
        poly("pavement", [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]), // whole tile
        poly("turf", [[0, 0], [0.5, 0], [0.5, 1], [0, 1], [0, 0]]), // left-half median
      ],
    };
    const counts = classPixelCounts(rasterizeMask(fc, bounds));
    expect(counts[CLASS_INDEX.turf]).toBe(50); // median preserved as turf
    expect(counts[CLASS_INDEX.pavement]).toBe(50); // pavement fills the rest
    expect(counts[0]).toBe(0);
  });

  it("empty input yields all background", () => {
    const counts = classPixelCounts(rasterizeMask(null, bounds));
    expect(counts[0]).toBe(100);
  });
});
