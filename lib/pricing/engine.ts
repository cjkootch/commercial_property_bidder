import type {
  PricingConfig,
  PricingFlags,
  PricingMeasurement,
  PricingResult,
} from "./types";

/** Square feet in one acre. */
const SQFT_PER_ACRE = 43560;

/**
 * The crew cost per hour derived from config (defaults to 96):
 *   crew_size * labor_cost_per_person_hour + equipment_cost_per_crew_hour
 */
export function crewCostPerHour(config: PricingConfig): number {
  return (
    config.crew_size * config.labor_cost_per_person_hour +
    config.equipment_cost_per_crew_hour
  );
}

/**
 * Pure, dependency-free pricing engine. No DB calls, no I/O. Given a single
 * measurement and a config, it reproduces the spreadsheet exactly (build spec
 * section 5). Calculation order is significant and matches section 5.2.
 */
export function computePricing(
  measurement: PricingMeasurement,
  config: PricingConfig
): PricingResult {
  const complexity = measurement.complexity ?? 1.0;
  const { turf_sqft, bed_sqft } = measurement;

  const crew_cost_per_hour = crewCostPerHour(config);

  // --- Section 5.2: calculation (exact order) ---
  const turf_acres = turf_sqft / SQFT_PER_ACRE;
  const turf_time = turf_acres * config.turf_min_per_acre * complexity;
  const bed_time = (bed_sqft / 1000) * config.bed_min_per_1000sqft * complexity;
  const total_crew_min =
    turf_time + bed_time + config.fixed_min_per_stop + config.drive_min_per_stop;
  const crew_hours_per_visit = total_crew_min / 60;
  const cost_per_visit = crew_hours_per_visit * crew_cost_per_hour;

  const price_per_visit = Math.max(
    cost_per_visit / (1 - config.target_margin),
    config.min_price_per_visit
  );
  const gross_profit_per_visit = price_per_visit - cost_per_visit;
  const gross_margin_pct = gross_profit_per_visit / price_per_visit;
  const min_acceptable_price = Math.max(
    cost_per_visit / (1 - config.margin_floor),
    config.min_price_per_visit
  );
  const monthly_price = (price_per_visit * config.visits_per_year) / 12;
  const annual_price = price_per_visit * config.visits_per_year;
  const annual_gross_profit = gross_profit_per_visit * config.visits_per_year;
  const cole_annual_cut = annual_gross_profit * config.cole_profit_share;
  const implied_per_acre_visit =
    turf_acres > 0 ? price_per_visit / turf_acres : null;

  // --- Section 5.2: flags ---
  const large = turf_acres > config.max_turf_acres;
  const bed_heavy =
    turf_sqft > 0 && bed_sqft / turf_sqft > config.bed_turf_ratio_threshold;
  const high_value = monthly_price > config.monthly_review_threshold;
  const low_confidence = measurement.confidence === "Low";
  // Market sanity flags only apply once the lot is at least one acre.
  const below_market =
    turf_acres >= 1 &&
    implied_per_acre_visit !== null &&
    implied_per_acre_visit < config.market_floor_per_acre_visit;
  const above_market =
    turf_acres >= 1 &&
    implied_per_acre_visit !== null &&
    implied_per_acre_visit > config.market_ceiling_per_acre_visit;

  const reasons: string[] = [];
  if (large)
    reasons.push(
      `Large site: ${turf_acres.toFixed(2)} turf acres exceeds ${config.max_turf_acres}.`
    );
  if (bed_heavy)
    reasons.push(
      `Bed-heavy: bed area is ${((bed_sqft / turf_sqft) * 100).toFixed(0)}% of turf (threshold ${(config.bed_turf_ratio_threshold * 100).toFixed(0)}%).`
    );
  if (high_value)
    reasons.push(
      `High value: monthly price $${monthly_price.toFixed(2)} exceeds review threshold $${config.monthly_review_threshold}.`
    );
  if (low_confidence)
    reasons.push("Low measurement confidence — verify areas before sending.");
  if (below_market)
    reasons.push(
      `Below market: $${implied_per_acre_visit!.toFixed(0)}/acre/visit is under the floor $${config.market_floor_per_acre_visit}.`
    );
  if (above_market)
    reasons.push(
      `Above market: $${implied_per_acre_visit!.toFixed(0)}/acre/visit is over the ceiling $${config.market_ceiling_per_acre_visit}.`
    );

  const flags: PricingFlags = {
    large,
    bed_heavy,
    high_value,
    low_confidence,
    below_market,
    above_market,
    reasons,
  };

  const needs_review =
    large || bed_heavy || high_value || low_confidence || below_market || above_market;

  return {
    turf_acres,
    crew_hours_per_visit,
    cost_per_visit,
    price_per_visit,
    gross_profit_per_visit,
    gross_margin_pct,
    min_acceptable_price,
    monthly_price,
    annual_price,
    annual_gross_profit,
    cole_annual_cut,
    implied_per_acre_visit,
    flags,
    needs_review,
  };
}
