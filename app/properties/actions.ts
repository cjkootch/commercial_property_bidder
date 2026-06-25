"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { measurement, pricingResult, property } from "@/lib/db/schema";
import { getActiveConfig, getDefaultCompany, toEngineConfig } from "@/lib/db/queries";
import { computePricing } from "@/lib/pricing/engine";
import type { Confidence } from "@/lib/pricing/types";

const ICP_VALUES = [
  "self_storage",
  "office_park",
  "medical",
  "church",
  "daycare",
  "retail_strip",
  "industrial",
  "other",
] as const;

function num(formData: FormData, key: string, fallback = 0): number {
  const raw = formData.get(key);
  const n = raw === null || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Create a property (build spec section 7: /properties/new). */
export async function createProperty(formData: FormData) {
  const co = await getDefaultCompany();
  if (!co) throw new Error("No company seeded. Run `npm run db:seed`.");

  const name = (formData.get("name") as string)?.trim();
  if (!name) throw new Error("Property name is required.");

  const icpRaw = (formData.get("icp_type") as string) ?? "other";
  const icp = (ICP_VALUES as readonly string[]).includes(icpRaw)
    ? (icpRaw as (typeof ICP_VALUES)[number])
    : "other";

  const [prop] = await db
    .insert(property)
    .values({
      company_id: co.id,
      name,
      address: ((formData.get("address") as string) || "").trim() || null,
      city: ((formData.get("city") as string) || "").trim() || null,
      zip: ((formData.get("zip") as string) || "").trim() || null,
      icp_type: icp,
      owner_org: ((formData.get("owner_org") as string) || "").trim() || null,
      source: "manual",
      status: "sourced",
    })
    .returning();

  redirect(`/properties/${prop.id}`);
}

/**
 * Save measurements and recompute pricing in one shot (build spec section 7:
 * "recompute pricing on save"). Inserts a fresh measurement + pricing_result
 * snapshot and advances the pipeline to at least `priced`.
 */
export async function saveMeasurement(propertyId: string, formData: FormData) {
  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop) throw new Error("Property not found.");

  const cfgRow = await getActiveConfig(prop.company_id);
  if (!cfgRow) throw new Error("No active pricing config for this company.");

  const confidenceRaw = (formData.get("confidence") as string) ?? "Med";
  const confidence: Confidence = (["High", "Med", "Low"] as const).includes(
    confidenceRaw as Confidence
  )
    ? (confidenceRaw as Confidence)
    : "Med";

  const turf_sqft = num(formData, "turf_sqft");
  const bed_sqft = num(formData, "bed_sqft");
  const complexity = num(formData, "complexity", 1.0) || 1.0;

  const [meas] = await db
    .insert(measurement)
    .values({
      property_id: propertyId,
      turf_sqft,
      bed_sqft,
      shrub_count: Math.trunc(num(formData, "shrub_count")) || null,
      tree_count: Math.trunc(num(formData, "tree_count")) || null,
      edging_lf: num(formData, "edging_lf") || null,
      complexity: complexity.toFixed(2),
      confidence,
      source: "manual",
    })
    .returning();

  const result = computePricing(
    { turf_sqft, bed_sqft, complexity, confidence },
    toEngineConfig(cfgRow)
  );

  await db.insert(pricingResult).values({
    property_id: propertyId,
    measurement_id: meas.id,
    config_id: cfgRow.id,
    cost_per_visit: result.cost_per_visit,
    price_per_visit: result.price_per_visit,
    gross_profit_per_visit: result.gross_profit_per_visit,
    gross_margin_pct: result.gross_margin_pct,
    min_acceptable_price: result.min_acceptable_price,
    monthly_price: result.monthly_price,
    annual_price: result.annual_price,
    annual_gross_profit: result.annual_gross_profit,
    cole_annual_cut: result.cole_annual_cut,
    implied_per_acre_visit: result.implied_per_acre_visit,
    crew_hours_per_visit: result.crew_hours_per_visit,
    flags: result.flags,
    needs_review: result.needs_review,
  });

  // Advance pipeline to "priced" only from the initial stage; never downgrade.
  if (prop.status === "sourced") {
    await db.update(property).set({ status: "priced", updated_at: new Date() }).where(eq(property.id, propertyId));
  }

  revalidatePath(`/properties/${propertyId}`);
  revalidatePath("/dashboard");
}

/** Operator acknowledges the review flags (send gate, build spec section 6.2). */
export async function setAcknowledgedReview(propertyId: string, acknowledged: boolean) {
  await db
    .update(property)
    .set({ acknowledged_review: acknowledged, updated_at: new Date() })
    .where(eq(property.id, propertyId));
  revalidatePath(`/properties/${propertyId}`);
}
