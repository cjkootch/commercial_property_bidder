// Types for the pricing engine. Kept free of any DB/ORM imports so the engine
// stays a pure, dependency-free module (see lib/pricing/engine.ts).

export type Confidence = "High" | "Med" | "Low";

/**
 * All inputs to the pricing engine. Mirrors the `pricing_config` table
 * (section 5.1 of the build spec). The engine never reads anything outside
 * this object plus the measurement.
 */
export interface PricingConfig {
  crew_size: number;
  labor_cost_per_person_hour: number;
  equipment_cost_per_crew_hour: number;
  turf_min_per_acre: number;
  bed_min_per_1000sqft: number;
  fixed_min_per_stop: number;
  drive_min_per_stop: number;
  target_margin: number;
  margin_floor: number;
  min_price_per_visit: number;
  visits_per_year: number;
  cole_profit_share: number;
  max_turf_acres: number;
  bed_turf_ratio_threshold: number;
  monthly_review_threshold: number;
  market_floor_per_acre_visit: number;
  market_ceiling_per_acre_visit: number;
}

/**
 * The measurement inputs the engine consumes. `complexity` defaults to 1.0 if
 * omitted. Counts/edging are carried for completeness (the measurement table
 * stores them) but the v1 engine does not use them in the calculation.
 */
export interface PricingMeasurement {
  turf_sqft: number;
  bed_sqft: number;
  complexity?: number;
  confidence: Confidence;
  shrub_count?: number;
  tree_count?: number;
  edging_lf?: number;
}

export interface PricingFlags {
  large: boolean;
  bed_heavy: boolean;
  high_value: boolean;
  low_confidence: boolean;
  below_market: boolean;
  above_market: boolean;
  /** Human-readable explanations for whichever flags fired. */
  reasons: string[];
}

export interface PricingResult {
  turf_acres: number;
  crew_hours_per_visit: number;
  cost_per_visit: number;
  price_per_visit: number;
  gross_profit_per_visit: number;
  gross_margin_pct: number;
  min_acceptable_price: number;
  monthly_price: number;
  annual_price: number;
  annual_gross_profit: number;
  cole_annual_cut: number;
  /** null when there is no turf (no per-acre figure is meaningful). */
  implied_per_acre_visit: number | null;
  flags: PricingFlags;
  needs_review: boolean;
  /** Present only when computePricing is called with { breakdown: true }. */
  breakdown?: PricingBreakdown;
}

/** Options for computePricing. */
export interface PricingOptions {
  /** When true, attach the intermediate calculation values for auditing. */
  breakdown?: boolean;
}

/**
 * Intermediate values from the calculation chain (build spec section 5.2),
 * surfaced so the operator can audit how inputs become a price. These are the
 * same locals the engine already computes — nothing is recomputed or
 * duplicated.
 */
export interface PricingBreakdown {
  complexity: number;
  crew_cost_per_hour: number;
  turf_acres: number;
  turf_time: number; // crew-minutes
  bed_time: number; // crew-minutes
  fixed_min_per_stop: number; // crew-minutes
  drive_min_per_stop: number; // crew-minutes
  total_crew_min: number;
  crew_hours_per_visit: number;
  cost_per_visit: number;
  target_margin: number;
  price_before_floor: number; // cost / (1 - target_margin)
  min_price_per_visit: number;
  price_floored: boolean; // true if the per-visit minimum was binding
}
