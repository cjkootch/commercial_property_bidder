// Integration seam (build spec section 12). When SiteRecon (or another takeoff
// API) is wired up, implement fetchMeasurement so a measurement's `source` can
// flip from "manual" to "siterecon" without touching callers. Do NOT build it
// now — this stub documents the contract only.

export interface SiteReconMeasurement {
  turf_sqft: number;
  bed_sqft: number;
  shrub_count?: number;
  tree_count?: number;
  edging_lf?: number;
  confidence: "High" | "Med" | "Low";
}

export async function fetchMeasurement(
  _address: string
): Promise<SiteReconMeasurement> {
  throw new Error("NotImplemented: SiteRecon measurement API is a future seam.");
}
