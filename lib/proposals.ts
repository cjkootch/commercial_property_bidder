// Hosted-proposal helpers: slug generation, default scope, and frequency/pricing
// options derived from a pricing result. The proposal page renders LIVE data, so
// re-pricing or editing scope updates what the recipient sees even after the
// link is sent.

import type { PricingResultRow } from "./db/schema";

export type FrequencyOption = {
  label: string;
  visits_per_year: number;
  price_per_visit: number;
  monthly: number;
  annual: number;
};

/** Default scope of work shown on a grounds-maintenance proposal. */
export const DEFAULT_SCOPE_ITEMS = [
  "Mowing of all turf areas",
  "String trimming around obstacles & fence lines",
  "Edging of walks, curbs & drive approaches",
  "Blowing of clippings from all hard surfaces",
  "Landscape bed weed control",
  "Seasonal shrub & hedge trimming",
  "Litter & debris removal on each visit",
];

/** URL-safe slug from a property name + short random suffix (collision-safe). */
export function makeProposalSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "proposal";
  const rand = Math.random().toString(36).slice(2, 8);
  return `${base}-${rand}`;
}

/** Build the frequency/pricing options shown on the proposal from a pricing row. */
export function frequencyOptionsFromPricing(
  pr: Pick<
    PricingResultRow,
    "price_per_visit" | "monthly_price" | "annual_price"
  >,
  visitsPerYear: number
): FrequencyOption[] {
  return [
    {
      label: "Full-service grounds maintenance",
      visits_per_year: visitsPerYear,
      price_per_visit: pr.price_per_visit,
      monthly: pr.monthly_price,
      annual: pr.annual_price,
    },
  ];
}
