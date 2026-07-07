import type { residentialSignalTypeEnum, confidenceEnum } from "../db/schema";

type SignalType = (typeof residentialSignalTypeEnum.enumValues)[number];
type Confidence = (typeof confidenceEnum.enumValues)[number];

/**
 * Signal scoring guidance:
 * Very high value (100):
 * - new_construction
 * - certificate_of_occupancy
 * - permit_completed
 * - subdivision_phase
 *
 * High value (80):
 * - recently_sold
 *
 * Medium-high (60):
 * - newly_listed
 * - price_reduction
 * - stale_listing
 * - withdrawn_listing
 *
 * Low (20):
 * - manual
 */
export function scoreSignal(type: SignalType): number {
  switch (type) {
    case "new_construction":
    case "certificate_of_occupancy":
    case "permit_completed":
    case "subdivision_phase":
      return 100;
    case "recently_sold":
      return 80;
    case "newly_listed":
    case "price_reduction":
    case "stale_listing":
    case "withdrawn_listing":
      return 60;
    case "manual":
    default:
      return 20;
  }
}

/**
 * Confidence scoring helper:
 * High: 1.0 multiplier
 * Med: 0.7 multiplier
 * Low: 0.4 multiplier
 */
export function getConfidenceMultiplier(confidence: Confidence): number {
  switch (confidence) {
    case "High":
      return 1.0;
    case "Med":
      return 0.7;
    case "Low":
      return 0.4;
    default:
      return 0.7;
  }
}

/**
 * Combined score for sorting and qualification.
 */
export function calculateLeadScore(type: SignalType, confidence: Confidence): number {
  return Math.round(scoreSignal(type) * getConfidenceMultiplier(confidence));
}
