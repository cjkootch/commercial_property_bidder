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

/**
 * A county parcel (legal lot) boundary plus owner-of-record, resolved from a
 * county GIS service. The geometry is a reference overlay — it frames where the
 * property ends so the operator can trace the service area inside it. `owner`
 * may seed (operator-confirmed) owner_org for the contact step; it is never
 * auto-applied (build spec section 9).
 */
export interface ParcelResult {
  county: string;
  owner: string | null;
  parcel_id: string | null;
  address: string | null;
  acres: number | null;
  /** GeoJSON Polygon/MultiPolygon ring(s), [lng,lat]. */
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
}
