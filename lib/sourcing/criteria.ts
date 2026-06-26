// Property selection criteria for the autonomous sourcing pipeline.
//
// Before a candidate property is worth a full measure-&-quote pass, it must look
// like a grounds-maintenance prospect: a meaningful share of its parcel should be
// vegetated (grass/turf). We approximate this cheaply up front with the free RGB
// vegetation estimate (lib/integrations/imagery.estimateServiceableArea →
// vegetation_fraction) and gate on it here.
//
// Caveat (surfaced in the UI): "vegetation" includes tree canopy and beds, not
// just mowable grass — it is a coarse pre-screen, not the serviceable measurement.

/**
 * Minimum vegetation (≈ grass) coverage of the parcel for a property to be
 * "suggested" by the sourcing pipeline. 0.35 = at least ~35% green.
 * Business knob — adjust to tighten/loosen the funnel.
 */
export const MIN_GRASS_FRACTION = 0.35;

/**
 * Does this parcel clear the grass pre-screen?
 * `fraction` is the vegetated share of the parcel in [0, 1] (or null if not yet
 * screened). Null is treated as not-qualified so unscreened properties don't
 * silently pass the gate.
 */
export function isGrassQualified(
  fraction: number | null | undefined,
  threshold: number = MIN_GRASS_FRACTION
): boolean {
  return typeof fraction === "number" && Number.isFinite(fraction) && fraction >= threshold;
}

/** Format a 0..1 fraction as a whole-percent label, e.g. 0.42 -> "42%". */
export function grassPercentLabel(fraction: number | null | undefined): string {
  if (typeof fraction !== "number" || !Number.isFinite(fraction)) return "—";
  return `${Math.round(fraction * 100)}%`;
}
