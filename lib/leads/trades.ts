// The trade registry: every buyer vertical the marketplace sells to, in ONE
// place. The same property signal (transfer, opening, citation, tax sale)
// sells to multiple non-competing trades, so:
//
//   - the 3-spot cap, the exclusive, and the per-lead free budget are all
//     counted WITHIN a trade (lead_unlock.trade) — the scarcity promise reads
//     "capped at 3 landscaping companies", and it stays honest because a pest
//     company was never competing for those spots;
//   - each trade has its OWN ranking model (what makes a lead valuable is
//     trade-specific) and its own relevance filter (which kinds it sees);
//   - the bid-window multiplier (allocation.bidWindowMultiplier) is shared —
//     "is the decision being made now" is universal, the value model is not.
//
// Adding a trade = adding an entry here (+ prospecting keywords). Nothing
// else in the marketplace should hard-code a trade name.

import { bidWindowMultiplier, leadRank } from "./allocation";
import type { LeadKind } from "./market";

export type Trade = "landscaping" | "pest" | "cleaning" | "paving" | "security" | "hvac";

export const DEFAULT_TRADE: Trade = "landscaping";

export type TradeRankInput = {
  kind: LeadKind;
  /** Landscaping teaser ceiling (annual_hi) — other trades treat it only as
   *  a weak size proxy, never as their contract value. */
  annualHi: number | null;
  monthsToCompletion: number | null;
  urgent: boolean;
  icpType: string | null;
  /** Pipeline notes — trades read their own signals out of them. */
  notes: string | null;
};

export type TradeDef = {
  key: Trade;
  /** "landscaping" — used in buyer-facing copy ("3 landscaping companies"). */
  noun: string;
  label: string;
  /** Lowercase-safe service noun for prose ("year-round HVAC service
   *  contract") — label can't be lowercased blindly (HVAC). */
  service: string;
  /** Which leads this trade's shelf shows at all. */
  relevant: (kind: LeadKind) => boolean;
  /** The trade's OWN ranking model. Higher = better. */
  rank: (input: TradeRankInput) => number;
  /** Trade-specific sellability from the teaser. Only OPERATOR-VERIFIED
   *  numbers may disqualify — an automated estimate is never trusted enough
   *  to pull a lead. Omitted = always sellable. */
  sellable?: (teaser: { turf_sqft?: number; verified?: boolean } | null) => boolean;
  /** Apollo/scrape keywords for buyer prospecting. */
  prospectKeywords: string[];
};

/** A hand-measured property below this has no landscaping job on it. */
export const LANDSCAPING_MIN_TURF_SQFT = 500;

/**
 * Pest control value model (documented so the ranking is explainable):
 * a pest operator prices by structure + vertical, not turf. What they pay for:
 *   - food service opening (TABC / NAICS 72): pest contract is REQUIRED for
 *     the health permit — the closest thing to a guaranteed sale ......... 30k
 *   - apartments (B1 / residential icp): per-unit recurring contracts ..... 22k
 *   - citations for trash/dumping/stagnant water: active harborage/vector
 *     risk, owner already forced to act ................................. 20k
 *   - ownership transfer: every commercial building carries a pest
 *     contract and the new owner re-bids it ............................. 12k
 *   - other openings: first pest contract being signed .................. 12k
 *   - weeds-only citations: weaker for pest (harborage, not infestation) .. 9k
 *   - distress/construction: vacant-building rodent surge / first contract  8k
 *   - public grounds bids: not a pest product ............................. 0
 * The numbers are relative weights on the same scale as landscaping's
 * annual_hi so cross-trade code (free-claim quantiles) keeps working.
 */
function pestRank(i: TradeRankInput): number {
  const notes = i.notes ?? "";
  let base: number;
  switch (i.kind) {
    case "opening":
      // TABC notes say "TABC license application ..."; sales-tax restaurant
      // openings carry their NAICS 72x code in the notes.
      base = /TABC|NAICS 72|restaurant|food|\bbar\b/i.test(notes) ? 30_000 : 12_000;
      break;
    case "violation":
      base = /dumping|debris|stagnant/i.test(notes) ? 20_000 : 9_000;
      break;
    case "transfer":
      base = i.icpType === "residential" ? 22_000 : 12_000; // B1 apartments
      break;
    case "distress":
      base = i.icpType === "residential" ? 15_000 : 8_000;
      break;
    case "construction":
      base = 8_000;
      break;
    default:
      return 0; // rfp: grounds bids aren't a pest product
  }
  return base * bidWindowMultiplier(i.monthsToCompletion, i.urgent);
}

/**
 * Commercial cleaning / janitorial value model:
 *   - opening: pre-opening deep clean + the recurring janitorial contract,
 *     signed before day one ............................................. 25k
 *   - construction/TI: post-construction cleanup then a fresh recurring
 *     contract for the new space ........................................ 22k
 *   - transfer: every occupied building carries janitorial and the new
 *     owner re-bids it .................................................. 15k
 *   - dumping/debris citations: forced cleanup work ..................... 12k
 *   - distress: pre-sale cleanouts, vacant-property turns ................ 8k
 *   - weeds-only citations: not a cleaning product ....................... 4k
 *   - public grounds bids: not a cleaning product ......................... 0
 */
function cleaningRank(i: TradeRankInput): number {
  const notes = i.notes ?? "";
  let base: number;
  switch (i.kind) {
    case "opening":
      base = 25_000;
      break;
    case "construction":
      base = 22_000;
      break;
    case "transfer":
      base = 15_000;
      break;
    case "violation":
      base = /dumping|debris|trash/i.test(notes) ? 12_000 : 4_000;
      break;
    case "distress":
      base = 8_000;
      break;
    default:
      return 0; // rfp: grounds bids
  }
  return base * bidWindowMultiplier(i.monthsToCompletion, i.urgent);
}

/**
 * Paving / parking-lot maintenance value model: the buyer prices by lot, and
 * we uniquely measure pavement from the air (hardscape class) — the pitch's
 * moat. Signal weights:
 *   - construction: new/renovated sites need striping, sealcoat schedules,
 *     and the first lot-maintenance contract ............................ 20k
 *   - transfer: lot repair/restripe is the first thing a new owner sees
 *     on a condition report ............................................. 15k
 *   - opening: restripe/handicap compliance before doors open ........... 10k
 *   - distress: lots gone to seed pre-auction ............................ 6k
 *   - citations: occasionally lot-related dumping ........................ 5k
 *   - public grounds bids: not a paving product ........................... 0
 */
function pavingRank(i: TradeRankInput): number {
  let base: number;
  switch (i.kind) {
    case "construction":
      base = 20_000;
      break;
    case "transfer":
      base = 15_000;
      break;
    case "opening":
      base = 10_000;
      break;
    case "distress":
      base = 6_000;
      break;
    case "violation":
      base = 5_000;
      break;
    default:
      return 0;
  }
  return base * bidWindowMultiplier(i.monthsToCompletion, i.urgent);
}

/**
 * Security services value model: guarding/patrol prices by risk exposure.
 *   - construction: site theft is the industry's chronic loss — patrol and
 *     camera contracts run the whole build .............................. 22k
 *   - distress/tax sale: vacant properties need patrol NOW, and lenders
 *     often require it .................................................. 20k
 *   - dumping citations: unsecured-property signal — patrol sells ....... 12k
 *   - opening: new alarm/guard contracts before opening day ............. 12k
 *   - transfer: re-bid of the standing contract ......................... 10k
 *   - weeds-only citations ................................................ 3k
 *   - public grounds bids .................................................. 0
 */
function securityRank(i: TradeRankInput): number {
  const notes = i.notes ?? "";
  let base: number;
  switch (i.kind) {
    case "construction":
      base = 22_000;
      break;
    case "distress":
      base = 20_000;
      break;
    case "violation":
      base = /dumping|debris|trash/i.test(notes) ? 12_000 : 3_000;
      break;
    case "opening":
      base = 12_000;
      break;
    case "transfer":
      base = 10_000;
      break;
    default:
      return 0;
  }
  return base * bidWindowMultiplier(i.monthsToCompletion, i.urgent);
}

/**
 * Commercial HVAC service value model: maintenance agreements + service.
 *   - food-service opening: kitchen ventilation + refrigeration service is
 *     effectively mandatory ............................................. 26k
 *   - other openings: the first maintenance agreement being signed ...... 22k
 *   - construction/TI: brand-new equipment needs a service contract from
 *     day one (and TI scopes often include mechanical) .................. 18k
 *   - transfer: service agreements re-bid with the building .............. 14k
 *   - distress: neglected equipment pre-sale .............................. 5k
 *   - citations: rarely mechanical ........................................ 3k
 *   - public grounds bids .................................................. 0
 */
function hvacRank(i: TradeRankInput): number {
  const notes = i.notes ?? "";
  let base: number;
  switch (i.kind) {
    case "opening":
      base = /TABC|NAICS 72|restaurant|food|\bbar\b/i.test(notes) ? 26_000 : 22_000;
      break;
    case "construction":
      base = 18_000;
      break;
    case "transfer":
      base = 14_000;
      break;
    case "distress":
      base = 5_000;
      break;
    case "violation":
      base = 3_000;
      break;
    default:
      return 0;
  }
  return base * bidWindowMultiplier(i.monthsToCompletion, i.urgent);
}

export const TRADES: Record<Trade, TradeDef> = {
  landscaping: {
    key: "landscaping",
    noun: "landscaping companies",
    label: "Landscaping",
    service: "landscaping",
    relevant: () => true,
    // The operator measured it and there's no grass: not a landscaping lead,
    // whatever the signal was. (Stays sellable to trades that don't mow.)
    sellable: (t) => !(t?.verified && (t.turf_sqft ?? 0) < LANDSCAPING_MIN_TURF_SQFT),
    // The original universal model: measured contract value x bid window.
    rank: (i) => leadRank(i.annualHi, i.monthsToCompletion, i.urgent),
    prospectKeywords: [
      "commercial landscaping",
      "landscape maintenance",
      "lawn care",
      "grounds maintenance",
    ],
  },
  pest: {
    key: "pest",
    noun: "pest control companies",
    label: "Pest control",
    service: "pest control",
    relevant: (kind) => kind !== "rfp",
    rank: pestRank,
    prospectKeywords: [
      "pest control",
      "exterminator",
      "commercial pest control",
      "pest management",
    ],
  },
  cleaning: {
    key: "cleaning",
    noun: "commercial cleaning companies",
    label: "Cleaning",
    service: "commercial cleaning",
    relevant: (kind) => kind !== "rfp",
    rank: cleaningRank,
    prospectKeywords: [
      "commercial cleaning",
      "janitorial services",
      "office cleaning",
      "building maintenance services",
    ],
  },
  paving: {
    key: "paving",
    noun: "paving contractors",
    label: "Paving",
    service: "parking-lot maintenance",
    relevant: (kind) => kind !== "rfp",
    rank: pavingRank,
    prospectKeywords: [
      "paving contractor",
      "asphalt paving",
      "sealcoating",
      "parking lot striping",
    ],
  },
  security: {
    key: "security",
    noun: "security companies",
    label: "Security",
    service: "security",
    relevant: (kind) => kind !== "rfp",
    rank: securityRank,
    prospectKeywords: [
      "security guard services",
      "commercial security",
      "patrol services",
      "security company",
    ],
  },
  hvac: {
    key: "hvac",
    noun: "HVAC contractors",
    label: "HVAC",
    service: "HVAC service",
    relevant: (kind) => kind !== "rfp",
    rank: hvacRank,
    prospectKeywords: [
      "commercial HVAC",
      "mechanical contractor",
      "HVAC service",
      "air conditioning contractor",
    ],
  },
};

/** Parse an untrusted trade string (query param, form field) safely.
 *  hasOwnProperty, not `in`: "__proto__"/"toString" must not resolve. */
export function asTrade(v: unknown): Trade {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(TRADES, v)
    ? (v as Trade)
    : DEFAULT_TRADE;
}

export function tradeNoun(trade: string | null | undefined): string {
  return TRADES[asTrade(trade)].noun;
}
