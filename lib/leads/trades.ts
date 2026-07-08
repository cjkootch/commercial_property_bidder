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

export type Trade = "landscaping" | "pest";

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
  /** Which leads this trade's shelf shows at all. */
  relevant: (kind: LeadKind) => boolean;
  /** The trade's OWN ranking model. Higher = better. */
  rank: (input: TradeRankInput) => number;
  /** Apollo/scrape keywords for buyer prospecting. */
  prospectKeywords: string[];
};

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

export const TRADES: Record<Trade, TradeDef> = {
  landscaping: {
    key: "landscaping",
    noun: "landscaping companies",
    label: "Landscaping",
    relevant: () => true,
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
    relevant: (kind) => kind !== "rfp",
    rank: pestRank,
    prospectKeywords: [
      "pest control",
      "exterminator",
      "commercial pest control",
      "pest management",
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
