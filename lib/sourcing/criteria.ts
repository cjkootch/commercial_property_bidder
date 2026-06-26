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

/**
 * A recent ownership change is a buying-intent trigger: new owners commonly
 * re-bid grounds vendors. Within this many months counts as "recent".
 */
export const RECENT_OWNER_MONTHS = 24;

/** Whole months between an ISO date and now (>= 0), or null if unparseable. */
export function monthsSince(iso: string | null | undefined, asOf: Date = new Date()): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const months =
    (asOf.getFullYear() - d.getFullYear()) * 12 + (asOf.getMonth() - d.getMonth());
  return Math.max(0, months);
}

/** Did ownership change within RECENT_OWNER_MONTHS? (false when date unknown.) */
export function isRecentOwnerChange(
  iso: string | null | undefined,
  asOf: Date = new Date()
): boolean {
  const m = monthsSince(iso, asOf);
  return m !== null && m <= RECENT_OWNER_MONTHS;
}

/** Great-circle distance in miles between two [lng,lat] points. */
export function haversineMiles(a: [number, number], b: [number, number]): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Properties within this radius count toward route density. */
export const ROUTE_RADIUS_MILES = 3;

export type LeadScoreInput = {
  /** Vegetated share of the parcel in [0,1] (grass pre-screen). */
  grassFraction: number | null | undefined;
  /** Ownership changed within RECENT_OWNER_MONTHS. */
  recentOwnerChange: boolean;
  /** Operator flagged actively leasing / new PM. */
  activelyLeasing: boolean;
  /** Latest gross margin as a fraction (e.g. 0.40), if priced. */
  grossMarginPct: number | null | undefined;
  /** Count of other properties within ROUTE_RADIUS_MILES (route density). */
  neighborsNearby: number;
};

export type LeadScore = { score: number; reasons: string[] };

/**
 * Composite 0–100 lead score from signals we already collect — no external
 * calls. Higher = better prospect. Weights: grass fit 30, recent owner change
 * 25, actively leasing 20, margin fit 15, route density 10.
 */
export function computeLeadScore(input: LeadScoreInput): LeadScore {
  const reasons: string[] = [];
  let score = 0;

  const grass = typeof input.grassFraction === "number" ? input.grassFraction : 0;
  const grassPts = Math.min(grass / 0.6, 1) * 30; // 60%+ green = full
  score += grassPts;
  if (grassPts >= 15) reasons.push(`${Math.round(grass * 100)}% grass`);

  if (input.recentOwnerChange) {
    score += 25;
    reasons.push("recent owner change");
  }
  if (input.activelyLeasing) {
    score += 20;
    reasons.push("actively leasing");
  }

  const margin = typeof input.grossMarginPct === "number" ? input.grossMarginPct : 0;
  const marginPts = Math.min(Math.max(margin, 0) / 0.4, 1) * 15; // 40%+ margin = full
  score += marginPts;
  if (marginPts >= 10) reasons.push(`${Math.round(margin * 100)}% margin`);

  const densityPts = Math.min(input.neighborsNearby / 3, 1) * 10; // 3+ neighbors = full
  score += densityPts;
  if (input.neighborsNearby >= 2) reasons.push(`${input.neighborsNearby} nearby`);

  return { score: Math.round(score), reasons };
}
