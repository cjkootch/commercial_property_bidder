// Residential serviceable-area estimate from PROPERTY SQUARE FOOTAGE — no
// imagery/ML. Heavy tree canopy makes grass segmentation unreliable on homes, so
// we estimate the yard as lot − building footprint − a driveway allowance, using
// the county parcel (lot) + orthogonalized OSM building footprints (house). All
// vector data, so it also avoids the small-parcel static-tile zoom clamp.

import area from "@turf/area";
import { sqftFromM2 } from "../geo/area";
import { fetchOsmFeaturesInParcel } from "./osm";
import type { ParcelResult } from "../geo/types";

// Typical residential hardscape not captured by a building footprint (driveway,
// walks, patio). Subtracted only when we actually have a building footprint.
const DRIVEWAY_ALLOWANCE_SQFT = 600;
// When OSM has no building footprint, fall back to a typical mowed-yard share of
// the lot (front + back lawn, minus house/drive/beds).
const FALLBACK_YARD_FRACTION = 0.5;

export type ResidentialEstimate = {
  lot_sqft: number;
  building_sqft: number;
  turf_sqft: number;
  /** true when a real building footprint was subtracted (vs. the lot-fraction fallback). */
  from_footprint: boolean;
};

export async function estimateResidentialArea(parcel: ParcelResult): Promise<ResidentialEstimate> {
  const lot_sqft = Math.round(sqftFromM2(area(parcel.geometry as GeoJSON.Geometry)));

  const feats = await fetchOsmFeaturesInParcel(parcel);
  const buildingM2 = feats
    .filter((f) => f.properties.kind === "building")
    .reduce((sum, f) => sum + area(f.geometry as GeoJSON.Geometry), 0);
  const building_sqft = Math.round(sqftFromM2(buildingM2));

  const from_footprint = building_sqft > 0;
  const turf_sqft = from_footprint
    ? Math.max(0, lot_sqft - building_sqft - DRIVEWAY_ALLOWANCE_SQFT)
    : Math.round(lot_sqft * FALLBACK_YARD_FRACTION);

  return { lot_sqft, building_sqft, turf_sqft, from_footprint };
}
