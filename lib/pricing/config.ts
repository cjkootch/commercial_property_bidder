import type { PricingConfig } from "./types";

/**
 * Default seed values for the active pricing_config (build spec section 5.1).
 * The seed script inserts these as version 1 / is_active = true. Configs are
 * never mutated in place: editing /config inserts a new version and flips the
 * active flag.
 */
export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  crew_size: 3,
  labor_cost_per_person_hour: 22,
  equipment_cost_per_crew_hour: 30,
  turf_min_per_acre: 38,
  bed_min_per_1000sqft: 4,
  fixed_min_per_stop: 10,
  drive_min_per_stop: 10,
  target_margin: 0.4,
  margin_floor: 0.35,
  min_price_per_visit: 70,
  visits_per_year: 40,
  cole_profit_share: 0.5,
  max_turf_acres: 3.0,
  bed_turf_ratio_threshold: 0.2,
  monthly_review_threshold: 1500,
  market_floor_per_acre_visit: 50,
  market_ceiling_per_acre_visit: 150,
};
