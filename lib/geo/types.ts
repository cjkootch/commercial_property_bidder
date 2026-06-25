// Geometry types for the map measure-&-audit workspace. Kept dependency-free
// (plain GeoJSON shapes) so both client (Mapbox) and server (persistence) can
// share them.

/** What a drawn polygon represents on the property. */
export type AreaKind = "turf" | "bed" | "exclude";

/** A single drawn polygon: a GeoJSON Polygon feature tagged with its kind. */
export interface ServiceAreaFeature {
  type: "Feature";
  id?: string | number;
  properties: {
    kind: AreaKind;
    /** Computed planar area of this polygon, in square feet. */
    area_sqft: number;
  };
  geometry: {
    type: "Polygon";
    // GeoJSON rings: array of linear rings, each [lng, lat][].
    coordinates: number[][][];
  };
}

/** The full set of drawn areas for a measurement (what draw.getAll() yields). */
export interface ServiceAreaCollection {
  type: "FeatureCollection";
  features: ServiceAreaFeature[];
}

/** Persisted map camera so the audit view re-renders at the same framing. */
export interface MapView {
  center: [number, number]; // [lng, lat]
  zoom: number;
}

/** Totals derived from a ServiceAreaCollection, fed into the pricing engine. */
export interface AreaTotals {
  turf_sqft: number;
  bed_sqft: number;
  exclude_sqft: number;
}
