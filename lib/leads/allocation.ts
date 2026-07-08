// Yield management for the lead marketplace: WHO gets offered a lead, and
// WHEN a free claim is allowed. The free sheet is an acquisition tool — a
// landscaper who claims one and wins work becomes a paying repeat buyer — but
// every free claim burns one of the 3 sellable spots on real inventory. These
// rules keep the free tap generous when the shelf is full and shut when it
// isn't, and they never give away the headline job that sells the marketplace.
//
// All knobs are exported consts (business levers, not magic numbers).

/** Of the LEAD_MAX_BUYERS spots on a lead, at most this many can go free —
 *  the rest are always sellable. */
export const FREE_MAX_PER_LEAD = 1;

/** A brand-new lead gets this many days of paid-only first look. */
export const FREE_MIN_AGE_DAYS = 3;

/** After this long unsold, a lead becomes free-eligible regardless of value:
 *  bid windows expire, and an aging lead seeds activation + route density
 *  instead of expiring worthless. */
export const FREE_CLEARANCE_DAYS = 21;

/** Leads in the top quarter of open inventory by contract value are paid-only
 *  (until clearance age) — the #1 opportunity is what the offer email sells. */
export const FREE_PROTECT_QUANTILE = 0.75;

/** Fallback protection when inventory is too thin for a meaningful quantile. */
export const FREE_PROTECT_ANNUAL_HI = 25_000;

/** Free claims pause entirely when open sellable spots drop below this —
 *  scarce inventory is for paying buyers. */
export const FREE_MIN_OPEN_SPOTS = 6;

export type FreeClaimLead = {
  /** Teaser contract value ceiling (annual_hi), if sized. */
  annualHi: number | null;
  /** Days since the lead was sourced. */
  ageDays: number;
  /** Free unlocks already spent on this lead. */
  freeUnlocksOnLead: number;
  /** Shared spots still open on this lead. */
  spotsLeft: number;
};

export type FreeClaimContext = {
  /** annual_hi of every OPEN lead in the marketplace (including this one). */
  openValues: number[];
  /** Total open shared spots across the marketplace. */
  openSpots: number;
};

export type FreeClaimVerdict = { allowed: boolean; reason: string };

/** The q-th quantile of xs (linear interpolation); 0 for an empty list. */
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/**
 * Should THIS lead be claimable for free right now? Deterministic and
 * explainable — the reason string is shown to the operator (and drives which
 * buttons a buyer sees). The per-buyer "one free sheet ever" rule is enforced
 * separately at the claim actions; this is the per-lead / per-market policy.
 *
 * Note: campaign claim links (operator-issued tokens for a specific lead)
 * bypass the value/age/inventory rules on purpose — the operator chose to
 * offer that lead as the hook — but the per-lead free cap still applies.
 */
export function evaluateFreeClaim(lead: FreeClaimLead, ctx: FreeClaimContext): FreeClaimVerdict {
  if (lead.spotsLeft <= 0) {
    return { allowed: false, reason: "Sold out — every spot on this job is taken." };
  }
  if (lead.freeUnlocksOnLead >= FREE_MAX_PER_LEAD) {
    return {
      allowed: false,
      reason: "The free spot on this job is already claimed — remaining spots are paid.",
    };
  }
  // Clearance overrides every protection below: an expiring lead in a buyer's
  // hands beats an expired lead in nobody's.
  if (lead.ageDays >= FREE_CLEARANCE_DAYS) {
    return { allowed: true, reason: "Aging inventory — free claim allowed to keep it moving." };
  }
  if (lead.ageDays < FREE_MIN_AGE_DAYS) {
    return {
      allowed: false,
      reason: `Fresh job — paid buyers get the first ${FREE_MIN_AGE_DAYS} days.`,
    };
  }
  const hi = lead.annualHi ?? 0;
  const protectAt =
    ctx.openValues.length >= 4
      ? Math.max(quantile(ctx.openValues, FREE_PROTECT_QUANTILE), FREE_PROTECT_ANNUAL_HI)
      : FREE_PROTECT_ANNUAL_HI;
  if (hi >= protectAt) {
    return {
      allowed: false,
      reason: "Headline job — the top of the shelf is never given away.",
    };
  }
  if (ctx.openSpots < FREE_MIN_OPEN_SPOTS) {
    return {
      allowed: false,
      reason: `Inventory is tight (${ctx.openSpots} open spots) — free claims are paused until more jobs land.`,
    };
  }
  return { allowed: true, reason: "Mid-shelf job with healthy inventory — free claim open." };
}

/** Days since a timestamp (fractional). */
export function daysSince(at: Date, asOf: Date = new Date()): number {
  return (asOf.getTime() - at.getTime()) / 86400_000;
}

/**
 * Offer ranking used everywhere a "next best" is needed (dashboard order, the
 * waterfall fallback when an offered job filled up): contract value per mile
 * of drive — a big job justifies a longer run, a small one has to be close.
 * Unknown distances assume a 30-mile run so unlocated leads still list.
 */
export function offerRank(annualHi: number | null | undefined, miles: number | null): number {
  return (annualHi ?? 0) / ((miles ?? 30) + 20);
}
