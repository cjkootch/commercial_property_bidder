// Value-based lead pricing, kept deliberately simple: THREE tiers derived
// automatically from the teaser's contract-value ceiling (annual_hi). No
// per-lead manual pricing, no dynamic repricing — one number in, one tier out,
// so every surface (dashboard card, checkout, credit redemption, prospecting
// email) quotes the same price for the same lead.
//
//   premium   annual_hi >= $25k   the headline jobs — worth paying up for
//   standard  $10k – $25k         the anchor price (LEAD_PRICE_USD env)
//   value     < $10k              volume tier: real signal, smaller contract
//
// The premium boundary is shared with the free-claim policy
// (lib/leads/allocation): a lead worth charging extra for is also never
// given away. Env overrides: LEAD_PRICE_USD / LEAD_EXCLUSIVE_PRICE_USD anchor
// the standard tier (existing knobs); LEAD_PRICE_PREMIUM_USD /
// LEAD_PRICE_VALUE_USD (+ _EXCLUSIVE_ variants) override the other two.

import { exclusivePriceCents, leadPriceCents } from "../integrations/stripe";

/** annual_hi at or above this = premium (also the never-free boundary). */
export const PREMIUM_MIN_ANNUAL_HI = 25_000;
/** annual_hi below this = value tier. */
export const VALUE_MAX_ANNUAL_HI = 10_000;

const envUsd = (name: string, fallbackCents: number): number => {
  const usd = Number(process.env[name]);
  return Number.isFinite(usd) && usd > 0 ? Math.round(usd * 100) : fallbackCents;
};

export type LeadTier = {
  tier: "premium" | "standard" | "value";
  /** Buyer-facing chip label; null for standard (no chip — it's the norm). */
  label: string | null;
  price_cents: number;
  exclusive_cents: number;
};

/** The tier for a lead given its teaser annual_hi (unsized = standard).
 *  Violation (citation) leads floor at STANDARD regardless of contract size:
 *  the buyer isn't paying for the contract, they're paying for a prospect
 *  who is legally required to hire someone this week. Big cited properties
 *  still reach premium on value alone. */
export function leadTierFor(
  annualHi: number | null | undefined,
  kind?: string | null
): LeadTier {
  if (typeof annualHi === "number" && annualHi >= PREMIUM_MIN_ANNUAL_HI) {
    return {
      tier: "premium",
      label: "PREMIUM JOB",
      price_cents: envUsd("LEAD_PRICE_PREMIUM_USD", 12900),
      exclusive_cents: envUsd("LEAD_EXCLUSIVE_PRICE_PREMIUM_USD", 29900),
    };
  }
  const value =
    typeof annualHi === "number" && annualHi > 0 && annualHi < VALUE_MAX_ANNUAL_HI;
  if (value && kind !== "violation") {
    return {
      tier: "value",
      label: "VOLUME DEAL",
      price_cents: envUsd("LEAD_PRICE_VALUE_USD", 3900),
      exclusive_cents: envUsd("LEAD_EXCLUSIVE_PRICE_VALUE_USD", 9900),
    };
  }
  return {
    tier: "standard",
    label: kind === "violation" ? "MUST-HIRE OWNER" : null,
    price_cents: leadPriceCents(),
    exclusive_cents: exclusivePriceCents(),
  };
}
