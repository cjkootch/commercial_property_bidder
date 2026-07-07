// Shared maintenance-account sizing for permit leads: measure (RGB veg, with a
// parcel-fraction projection on raw-dirt construction sites) and price with the
// engine IN-MEMORY — nothing persisted, so the sales pipeline stays clean.
// Used by the job-sheet renderer and the buyer campaign kit so both quote the
// same numbers.

import area from "@turf/area";
import { estimateServiceableArea } from "../integrations/imagery";
import { computePricing } from "../pricing/engine";
import { M2_TO_SQFT } from "../geo/area";
import type { ParcelResult } from "../geo/types";
import type { PricingConfig } from "../pricing/types";

/** Typical share of a finished commercial lot kept as maintained grounds. */
const PROJECTED_GROUNDS_FRACTION = 0.35;

export type LeadSizing = {
  turf_sqft: number;
  /** true when the site read as raw dirt and turf was projected from parcel geometry. */
  projected: boolean;
  acres: number;
  annual_lo: number;
  annual_hi: number;
  monthly: number;
  crew_hours_per_visit: number;
  turf_acres: number;
};

const roundTo = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);

export async function sizeLead(
  parcel: ParcelResult,
  token: string,
  cfg: PricingConfig
): Promise<LeadSizing> {
  const est = await estimateServiceableArea(parcel, token);
  const parcelSqft = area(parcel.geometry as GeoJSON.Geometry) * M2_TO_SQFT;
  const projected = !est || est.turf_sqft < parcelSqft * 0.08;
  const turf = Math.round(projected ? parcelSqft * PROJECTED_GROUNDS_FRACTION : est!.turf_sqft);
  const priced = computePricing(
    { turf_sqft: turf, bed_sqft: 0, complexity: 1.0, confidence: "Low" },
    cfg
  );
  return {
    turf_sqft: turf,
    projected,
    acres: parcelSqft / 43560,
    annual_lo: roundTo(priced.annual_price * 0.8, 100),
    annual_hi: roundTo(priced.annual_price * 1.2, 100),
    monthly: priced.monthly_price,
    crew_hours_per_visit: priced.crew_hours_per_visit,
    turf_acres: priced.turf_acres,
  };
}
