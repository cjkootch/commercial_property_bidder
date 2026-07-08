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

/** Signed months from now until an ISO date (negative = in the past), or null. */
export function monthsUntil(iso: string | null | undefined, asOf: Date = new Date()): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return (d.getTime() - asOf.getTime()) / (30.44 * 86400_000);
}

/** Assumed build duration when a TABS filing has a start date but no
 *  completion date. Business knob. */
export const ASSUMED_BUILD_MONTHS = 12;

/**
 * Best completion estimate from a property's pipeline notes:
 * "Est. completion YYYY-MM-DD." wins; else "Est. start YYYY-MM-DD." plus an
 * assumed ASSUMED_BUILD_MONTHS build. Null for properties with no construction
 * timeline (existing buildings) — the timing signal then doesn't apply.
 */
export function estimateCompletionFromNotes(
  notes: string | null | undefined
): { iso: string; assumed: boolean } | null {
  if (!notes) return null;
  const done = notes.match(/Est\. completion (\d{4}-\d{2}-\d{2})/);
  if (done) return { iso: done[1], assumed: false };
  const start = notes.match(/Est\. start (\d{4}-\d{2}-\d{2})/);
  if (!start) return null;
  const d = new Date(start[1]);
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + ASSUMED_BUILD_MONTHS);
  return { iso: d.toISOString().slice(0, 10), assumed: true };
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
  /** Signed months until est. construction completion (negative = already
   *  done). Null/undefined = no construction timeline — the timing signal
   *  doesn't apply and the score normalizes over the remaining signals. */
  monthsToCompletion?: number | null;
};

/** One scored signal, with a plain-English explanation for the audit UI. */
export type LeadScorePart = { label: string; points: number; max: number; note: string };

export type LeadScore = { score: number; reasons: string[]; parts: LeadScorePart[] };

/** Urgency points (0..20) from months-to-completion, with the explanation.
 *  The sweet spot is 1–6 months out: the ~90-day engage-by window is open. */
function timingSignal(m: number): { points: number; note: string; urgent: boolean } {
  const inMo = Math.abs(Math.round(m));
  if (m >= 12)
    return { points: 6, note: `Completion is ~${inMo} months out — on the radar; engaging this early rarely sticks.`, urgent: false };
  if (m >= 6)
    return { points: 12, note: `Completes in ~${inMo} months — time to get on the owner's bidder list.`, urgent: false };
  if (m >= 1)
    return { points: 20, note: `Completes in ~${inMo} month${inMo === 1 ? "" : "s"} — the bid window is open NOW (grounds vendors are typically chosen ~90 days before opening).`, urgent: true };
  if (m >= -2)
    return { points: 18, note: "Completing right about now — vendor decisions are being made this month.", urgent: true };
  if (m >= -6)
    return { points: 10, note: `Completed ~${inMo} months ago — the first contract may be settled, but it's fresh enough to contest.`, urgent: false };
  return { points: 2, note: `Completed ~${inMo} months ago — likely locked in until the next re-bid.`, urgent: false };
}

/**
 * Composite 0–100 lead score from signals we already collect — no external
 * calls. Higher = better prospect. Weights: grass fit 25, recent owner change
 * 20, timing/urgency 20, actively leasing 15, margin fit 10, route density 10.
 * When a property has no construction timeline the timing signal doesn't apply
 * and the score normalizes over the remaining 80 points — existing buildings
 * aren't penalized for not being construction projects. `parts` carries the
 * per-signal breakdown so the UI can explain WHY a property scored what it did.
 */
export function computeLeadScore(input: LeadScoreInput): LeadScore {
  const reasons: string[] = [];
  const parts: LeadScorePart[] = [];
  let score = 0;

  const screened = typeof input.grassFraction === "number";
  const grass = screened ? (input.grassFraction as number) : 0;
  const grassPts = Math.min(grass / 0.6, 1) * 25; // 60%+ green = full
  score += grassPts;
  if (grassPts >= 12.5) reasons.push(`${Math.round(grass * 100)}% grass`);
  parts.push({
    label: "Grass coverage",
    points: Math.round(grassPts),
    max: 25,
    note: screened
      ? `${Math.round(grass * 100)}% of the parcel is vegetated — more grass, more mowing revenue (full credit at 60%+).`
      : "Not screened yet — run the grass screen to score this signal.",
  });

  if (input.recentOwnerChange) {
    score += 20;
    reasons.push("recent owner change");
  }
  parts.push({
    label: "Recent owner change",
    points: input.recentOwnerChange ? 20 : 0,
    max: 20,
    note: input.recentOwnerChange
      ? `County records show the property changed hands within the last ${RECENT_OWNER_MONTHS} months — new owners re-bid their vendors.`
      : `No ownership change in the last ${RECENT_OWNER_MONTHS} months on county record (or no sale date available).`,
  });

  // Timing / urgency — only for properties with a construction timeline.
  const hasTiming = typeof input.monthsToCompletion === "number";
  let maxApplicable = 80;
  if (hasTiming) {
    maxApplicable = 100;
    const t = timingSignal(input.monthsToCompletion as number);
    score += t.points;
    if (t.urgent) reasons.push("urgent bid window");
    parts.push({ label: "Timing / urgency", points: t.points, max: 20, note: t.note });
  } else {
    parts.push({
      label: "Timing / urgency",
      points: 0,
      max: 0,
      note: "No construction timeline — an existing property; scored on the other signals only.",
    });
  }

  if (input.activelyLeasing) {
    score += 15;
    reasons.push("actively leasing");
  }
  parts.push({
    label: "Actively leasing / new PM",
    points: input.activelyLeasing ? 15 : 0,
    max: 15,
    note: input.activelyLeasing
      ? "Flagged as actively leasing or under a new property manager — decisions are being made right now."
      : "Not flagged as actively leasing (set it on the property when you spot a leasing banner or a new PM).",
  });

  const priced = typeof input.grossMarginPct === "number";
  const margin = priced ? (input.grossMarginPct as number) : 0;
  const marginPts = Math.min(Math.max(margin, 0) / 0.4, 1) * 10; // 40%+ margin = full
  score += marginPts;
  if (marginPts >= 7) reasons.push(`${Math.round(margin * 100)}% margin`);
  parts.push({
    label: "Margin fit",
    points: Math.round(marginPts),
    max: 10,
    note: priced
      ? `Priced at ${Math.round(margin * 100)}% gross margin (full credit at 40%+).`
      : "Not priced yet — measure it to score this signal.",
  });

  const densityPts = Math.min(input.neighborsNearby / 3, 1) * 10; // 3+ neighbors = full
  score += densityPts;
  if (input.neighborsNearby >= 2) reasons.push(`${input.neighborsNearby} nearby`);
  parts.push({
    label: "Route density",
    points: Math.round(densityPts),
    max: 10,
    note:
      input.neighborsNearby > 0
        ? `${input.neighborsNearby} other propert${input.neighborsNearby === 1 ? "y" : "ies"} in the book within ${ROUTE_RADIUS_MILES} miles — tight routes cut drive time and raise margins.`
        : `Nothing else in the book within ${ROUTE_RADIUS_MILES} miles yet — winning this one makes it a route anchor.`,
  });

  return { score: Math.round((score / maxApplicable) * 100), reasons, parts };
}
