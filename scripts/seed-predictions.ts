import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, isNotNull } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { computeEffectiveTurf, roundSqft } from "../lib/geo/area";
import { getActiveConfig, toEngineConfig } from "../lib/db/queries";
import { computePricing } from "../lib/pricing/engine";
import type { MapView, ServiceAreaCollection } from "../lib/geo/types";

// Step 3 of the self-training loop: insert the Python predictions as editable
// 'ml_pred' draft measurements. The operator opens each property, corrects the
// predicted turf, and saves — producing a clean human label. Drafts are skipped
// for any property that already has a saved label (incl. a prior ml_pred).

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
const db = drizzle(neon(url), { schema });

type Prediction = {
  property_id: string;
  name: string;
  service_areas: ServiceAreaCollection;
  /** Model self-assessment (predict_turf.py): sigmoid margin inside the parcel
   *  (0 = coin-flip, 1 = certain) + the model's vegetation fraction. */
  confidence?: { turf_margin: number; mean_margin: number; veg_frac: number };
  map_view: MapView;
};

/**
 * Gate a model draft's measurement confidence. "Med" requires BOTH a decisive
 * model (high margin) AND agreement with the independent RGB vegetation
 * fraction — an uncalibrated margin alone can be confidently wrong. Anything
 * else stays "Low" (needs review). "High" is reserved for human labels.
 */
function draftConfidence(
  conf: Prediction["confidence"],
  rgbVegFrac: number | null
): { level: "Med" | "Low"; why: string } {
  if (!conf) return { level: "Low", why: "no confidence data" };
  const margin = conf.turf_margin;
  if (rgbVegFrac == null) return { level: "Low", why: `margin ${margin.toFixed(2)}, no RGB cross-check` };
  const disagree = Math.abs(conf.veg_frac - rgbVegFrac);
  const why = `margin ${margin.toFixed(2)}, veg model ${(conf.veg_frac * 100).toFixed(0)}% vs RGB ${(rgbVegFrac * 100).toFixed(0)}%`;
  if (margin >= 0.75 && disagree <= 0.15) return { level: "Med", why };
  return { level: "Low", why };
}

async function main() {
  const preds: Prediction[] = JSON.parse(await readFile("ml/predictions.json", "utf8"));

  // Skip only properties with a HUMAN label (non-ml_pred). Properties that have
  // only a prior model draft are re-seeded, so re-running with a newer model
  // refreshes stale drafts (the latest measurement wins in the workspace).
  const alreadyLabeled = new Set(
    (
      await db
        .select({ pid: schema.measurement.property_id, source: schema.measurement.source })
        .from(schema.measurement)
        .where(isNotNull(schema.measurement.service_areas))
    )
      .filter((r) => r.source !== "ml_pred")
      .map((r) => r.pid)
  );

  let n = 0;
  for (const p of preds) {
    if (!p.service_areas.features.length) {
      console.log(`  skip (model found no turf): ${p.name}`);
      continue;
    }
    if (alreadyLabeled.has(p.property_id)) {
      console.log(`  skip (already has a label/draft): ${p.name}`);
      continue;
    }
    const [prop] = await db.select().from(schema.property).where(eq(schema.property.id, p.property_id)).limit(1);
    if (!prop) continue;
    const cfgRow = await getActiveConfig(prop.company_id);
    if (!cfgRow) continue;

    const rgbVeg = prop.grass_fraction != null ? Number(prop.grass_fraction) : null;
    const { level, why } = draftConfidence(p.confidence, rgbVeg);

    const turf_sqft = roundSqft(computeEffectiveTurf(p.service_areas, false));
    const [meas] = await db
      .insert(schema.measurement)
      .values({
        property_id: p.property_id,
        turf_sqft,
        bed_sqft: 0,
        complexity: "1.00",
        confidence: level,
        source: "ml_pred",
        service_areas: p.service_areas,
        map_view: p.map_view,
      })
      .returning();

    const result = computePricing(
      { turf_sqft, bed_sqft: 0, complexity: 1.0, confidence: level },
      toEngineConfig(cfgRow)
    );
    await db.insert(schema.pricingResult).values({
      property_id: p.property_id,
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
    n++;
    console.log(
      `  drafted: ${p.name} — turf ${turf_sqft.toLocaleString()} sf ` +
        `(${p.service_areas.features.length} polys) [${level}: ${why}]`
    );
  }
  console.log(`\nDone. Seeded ${n} ml_pred draft(s). Open them, correct the turf, and Save.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
