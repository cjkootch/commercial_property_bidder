import { and, desc, eq } from "drizzle-orm";
import { db } from "./index";
import {
  company,
  measurement,
  pricingConfig,
  pricingResult,
  property,
  type PricingConfigRow,
} from "./schema";
import type { PricingConfig, PricingFlags } from "../pricing/types";

/** Map a pricing_config DB row to the engine's PricingConfig shape. */
export function toEngineConfig(row: PricingConfigRow): PricingConfig {
  return {
    crew_size: row.crew_size,
    labor_cost_per_person_hour: row.labor_cost_per_person_hour,
    equipment_cost_per_crew_hour: row.equipment_cost_per_crew_hour,
    turf_min_per_acre: row.turf_min_per_acre,
    bed_min_per_1000sqft: row.bed_min_per_1000sqft,
    fixed_min_per_stop: row.fixed_min_per_stop,
    drive_min_per_stop: row.drive_min_per_stop,
    target_margin: row.target_margin,
    margin_floor: row.margin_floor,
    min_price_per_visit: row.min_price_per_visit,
    visits_per_year: row.visits_per_year,
    cole_profit_share: row.cole_profit_share,
    max_turf_acres: row.max_turf_acres,
    bed_turf_ratio_threshold: row.bed_turf_ratio_threshold,
    monthly_review_threshold: row.monthly_review_threshold,
    market_floor_per_acre_visit: row.market_floor_per_acre_visit,
    market_ceiling_per_acre_visit: row.market_ceiling_per_acre_visit,
  };
}

/** The single MVP company (first row). */
export async function getDefaultCompany() {
  const [row] = await db.select().from(company).limit(1);
  return row ?? null;
}

/** The active pricing config for a company. */
export async function getActiveConfig(companyId: string) {
  const [row] = await db
    .select()
    .from(pricingConfig)
    .where(and(eq(pricingConfig.company_id, companyId), eq(pricingConfig.is_active, true)))
    .orderBy(desc(pricingConfig.version))
    .limit(1);
  return row ?? null;
}

export type DashboardRow = {
  id: string;
  name: string;
  city: string | null;
  icp_type: string;
  status: string;
  owner_org: string | null;
  acknowledged_review: boolean;
  annual_price: number | null;
  monthly_price: number | null;
  cole_annual_cut: number | null;
  needs_review: boolean;
};

/** All properties with their most recent pricing result, for the dashboard. */
export async function listDashboard(companyId: string): Promise<DashboardRow[]> {
  const props = await db
    .select()
    .from(property)
    .where(eq(property.company_id, companyId))
    .orderBy(desc(property.created_at));

  const rows: DashboardRow[] = [];
  for (const p of props) {
    const [pr] = await db
      .select()
      .from(pricingResult)
      .where(eq(pricingResult.property_id, p.id))
      .orderBy(desc(pricingResult.computed_at))
      .limit(1);
    rows.push({
      id: p.id,
      name: p.name,
      city: p.city,
      icp_type: p.icp_type,
      status: p.status,
      owner_org: p.owner_org,
      acknowledged_review: p.acknowledged_review,
      annual_price: pr?.annual_price ?? null,
      monthly_price: pr?.monthly_price ?? null,
      cole_annual_cut: pr?.cole_annual_cut ?? null,
      needs_review: pr?.needs_review ?? false,
    });
  }
  return rows;
}

/** Full detail for one property: latest measurement + latest pricing result. */
export async function getPropertyDetail(propertyId: string) {
  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop) return null;

  const [meas] = await db
    .select()
    .from(measurement)
    .where(eq(measurement.property_id, propertyId))
    .orderBy(desc(measurement.measured_at))
    .limit(1);

  const [pr] = await db
    .select()
    .from(pricingResult)
    .where(eq(pricingResult.property_id, propertyId))
    .orderBy(desc(pricingResult.computed_at))
    .limit(1);

  return {
    property: prop,
    measurement: meas ?? null,
    pricing: pr ?? null,
    flags: (pr?.flags as PricingFlags | undefined) ?? null,
  };
}
