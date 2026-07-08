import { describe, expect, it } from "vitest";
import { demoteSportsTurf, sportsContextAllows } from "./turf-model";
import type { ServiceAreaCollection } from "../geo/types";

const sa = (kinds: string[]): ServiceAreaCollection => ({
  type: "FeatureCollection",
  features: kinds.map((kind, i) => ({
    type: "Feature" as const,
    properties: { kind: kind as never, area_sqft: 1000 * (i + 1) },
    geometry: { type: "Polygon" as const, coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
  })),
});

describe("integrations/turf-model — sports-turf screening", () => {
  it("context allows sports fields only where they're plausible", () => {
    expect(sportsContextAllows("Tomball ISD Athletic Complex")).toBe(true);
    expect(sportsContextAllows("St. Mary Church (HCAD 123)")).toBe(true);
    expect(sportsContextAllows("MacGregor Park pavilion")).toBe(true);
    expect(sportsContextAllows("Houston Country Club")).toBe(true);
    // Offices, retail, storage, industrial — never sports fields.
    expect(sportsContextAllows("North Cypress Professional Bldg I")).toBe(false);
    expect(sportsContextAllows("249 Self-Storage SAYLI ENTERPRISES LLC")).toBe(false);
    expect(sportsContextAllows("Tristar Convenience Stores Inc (TABC 585211)")).toBe(false);
  });

  it("demotes sports_turf to plain turf, preserving area and other kinds", () => {
    const { service_areas, demoted } = demoteSportsTurf(sa(["sports_turf", "turf", "bed", "sports_turf"]));
    expect(demoted).toBe(2);
    expect(service_areas.features.map((f) => f.properties.kind)).toEqual(["turf", "turf", "bed", "turf"]);
    // Areas untouched — same mowable ground, honest label.
    expect(service_areas.features.map((f) => f.properties.area_sqft)).toEqual([1000, 2000, 3000, 4000]);
  });

  it("no-ops when nothing is labeled sports_turf", () => {
    const input = sa(["turf", "bed"]);
    const { service_areas, demoted } = demoteSportsTurf(input);
    expect(demoted).toBe(0);
    expect(service_areas.features).toHaveLength(2);
  });
});
