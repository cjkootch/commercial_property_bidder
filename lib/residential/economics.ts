// The residential economic algorithm. Residential wins on CONSTANT FLOW, not
// scarcity — the exact opposite of the commercial model (3-spot cap, tiered
// one-off prices, free-claim protection). Homeowner signals are abundant
// (500+ recently-sold/month in Harris County alone, plus citations the 311
// feed already sees), individually tiny, and decay fast. So the unit
// economics are built around three principles:
//
//   1. VALUE = quality-weighted addresses. Each address contributes its
//      signal score x confidence x FRESHNESS DECAY — a mover contacted in the
//      first two weeks is worth ~7x one contacted after three months (they've
//      hired someone by then).
//   2. A package must clear MIN_PACKAGE_LEADS or it isn't a product — hold
//      small groups for the next cycle (learned in the R0 test: subdivision
//      grouping produced 1-lead "reports"). ZIP-month is the fallback bundle.
//   3. The end-state product is a SUBSCRIPTION: a ZIP's monthly feed at a
//      recurring price. Packages are how buyers sample; the subscription is
//      how they stay. Price both from the same per-address value so sampling
//      never undercuts subscribing.
//
// Sanity anchor: a buyer needs ONE win to justify ~20 packages. LTV of a
// residential account (Jules' calculator defaults) is ~$2,400-4,300; at a
// 2-5% win rate per fresh address, a 25-address package yields ~0.5-1.25
// wins. Per-address pricing keeps package cost under ~5% of expected LTV won.
// All knobs are exported consts (or env overrides) — business levers.

import { calculateLeadScore } from "./scoring";
import type { residentialSignalTypeEnum, confidenceEnum } from "../db/schema";

type SignalType = (typeof residentialSignalTypeEnum.enumValues)[number];
type Confidence = (typeof confidenceEnum.enumValues)[number];

/** A package below this many addresses isn't a product — hold for next cycle. */
export const MIN_PACKAGE_LEADS = 15;

/** Freshness decay of a homeowner signal (days since signal_date). */
export function freshnessDecay(ageDays: number): number {
  if (ageDays <= 14) return 1.0; // first-two-weeks window: they're deciding NOW
  if (ageDays <= 45) return 0.7; // still warm
  if (ageDays <= 90) return 0.4; // contested — many have hired
  return 0.15; // stale: only worth bundling as filler
}

/** Cents of package price per quality point (score 0-100 x decay).
 *  At the default, one FRESH recently-sold address (score 80) ≈ $2.00. */
export const CENTS_PER_QUALITY_POINT = 2.5;

/** Package price floor/cap keep small samples sellable and big bundles sane. */
export const PACKAGE_MIN_CENTS = 2900; // $29 — cheapest sample
export const PACKAGE_MAX_CENTS = 24900; // $249 — a very hot 100-address month

export type PackageLeadInput = {
  signalType: SignalType;
  confidence: Confidence;
  /** Days since the signal (sale date, citation date, CO date…). */
  ageDays: number;
};

/** Quality-weighted value of a package's addresses (the pricing base). */
export function packageQuality(leads: PackageLeadInput[]): number {
  return leads.reduce(
    (sum, l) => sum + calculateLeadScore(l.signalType, l.confidence) * freshnessDecay(l.ageDays),
    0
  );
}

export type PackagePricing = {
  /** false = below MIN_PACKAGE_LEADS; hold for the next cycle. */
  sellable: boolean;
  quality: number;
  price_cents: number;
  /** Same-package exclusive (nobody else in the ZIP this cycle). */
  exclusive_cents: number;
  /** What the same flow costs as a monthly ZIP subscription. */
  subscription_cents_per_month: number;
  per_address_cents: number;
};

/** How many buyers a residential package sells to (volume model still caps —
 *  30 companies door-knocking the same block burns the neighborhood). */
export const RESIDENTIAL_MAX_BUYERS = 3;

/** Exclusive = the whole cycle's flow in that ZIP to one buyer. */
export const EXCLUSIVE_MULTIPLIER = 2.2;

/** Subscription discount vs buying the same months as one-off packages —
 *  the retention lever: staying subscribed must beat cherry-picking. */
export const SUBSCRIPTION_DISCOUNT = 0.8;

/**
 * Price a package (and its subscription equivalent) from one number: the
 * quality-weighted address value. Volume, quality, and freshness all move the
 * price through the same lever, so a fat month costs more than a thin one and
 * stale filler barely moves it — buyers can trust that price tracks value.
 */
export function pricePackage(leads: PackageLeadInput[]): PackagePricing {
  const quality = Math.round(packageQuality(leads));
  const raw = Math.round(quality * CENTS_PER_QUALITY_POINT);
  const price = Math.min(PACKAGE_MAX_CENTS, Math.max(PACKAGE_MIN_CENTS, raw));
  const sellable = leads.length >= MIN_PACKAGE_LEADS;
  return {
    sellable,
    quality,
    price_cents: price,
    exclusive_cents: Math.round(price * EXCLUSIVE_MULTIPLIER),
    subscription_cents_per_month: Math.round(price * SUBSCRIPTION_DISCOUNT),
    per_address_cents: leads.length ? Math.round(price / leads.length) : 0,
  };
}

/**
 * Supply health for a ZIP: is the flow constant enough to sell a subscription?
 * A subscription needs a floor of fresh addresses per month — undersupplied
 * months prorate (credit) rather than silently thinning the feed. This is the
 * "constant flow" guarantee that makes the recurring product trustworthy.
 */
export const SUBSCRIPTION_MIN_LEADS_PER_MONTH = 12;

export function subscriptionViable(monthlyLeadCounts: number[]): boolean {
  if (monthlyLeadCounts.length < 2) return false; // need history to promise flow
  const avg = monthlyLeadCounts.reduce((a, b) => a + b, 0) / monthlyLeadCounts.length;
  const worst = Math.min(...monthlyLeadCounts);
  // Average must clear the floor and the worst month at least half of it.
  return avg >= SUBSCRIPTION_MIN_LEADS_PER_MONTH && worst >= SUBSCRIPTION_MIN_LEADS_PER_MONTH / 2;
}
