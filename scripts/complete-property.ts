import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import area from "@turf/area";
import * as schema from "../lib/db/schema";
import { computeEffectiveTurf, computeNetAreas, roundSqft, sqftFromM2 } from "../lib/geo/area";
import { getActiveConfig, toEngineConfig } from "../lib/db/queries";
import { computePricing } from "../lib/pricing/engine";
import type { ServiceAreaCollection, ServiceAreaFeature } from "../lib/geo/types";

// Final step of the gap-fill flow (after ml:dump-one + predict_turf.py): merge
// the operator's existing polygons with the model's gap-fill predictions into a
// new editable 'ml_pred' draft, then re-price. The operator opens the property,
// reviews the model's additions, fixes anything, and saves a clean label.
//
// Run:  npm run ml:complete -- "Woodlands Church"

const name = process.argv.slice(2).join(" ").trim();
if (!name) throw new Error('Usage: npm run ml:complete -- "Property Name"');

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
const db = drizzle(neon(url), { schema });

type Prediction = {
  property_id: string;
  name: string;
  service_areas: ServiceAreaCollection;
  map_view: { center: [number, number]; zoom: number };
};

function withArea(f: ServiceAreaFeature): ServiceAreaFeature {
  const sqft = roundSqft(
    sqftFromM2(area({ type: "Feature", properties: {}, geometry: f.geometry } as GeoJSON.Feature))
  );
  return { ...f, properties: { ...f.properties, area_sqft: sqft } };
}

async function main() {
  const preds: Prediction[] = JSON.parse(await readFile("ml/predictions.json", "utf8"));
  const pred = preds.find((p) => p.name === name) ?? preds[0];
  if (!pred) throw new Error("No prediction found in ml/predictions.json. Run predict_turf.py first.");

  const [prop] = await db.select().from(schema.property).where(eq(schema.property.id, pred.property_id)).limit(1);
  if (!prop) throw new Error(`Property ${pred.property_id} not found.`);

  // The operator's latest hand label.
  const [m] = await db
    .select()
    .from(schema.measurement)
    .where(
      and(
        eq(schema.measurement.property_id, prop.id),
        isNotNull(schema.measurement.service_areas),
        ne(schema.measurement.source, "ml_pred")
      )
    )
    .orderBy(desc(schema.measurement.measured_at))
    .limit(1);
  const existing = (m?.service_areas as ServiceAreaCollection | null)?.features ?? [];
  const gapfill = pred.service_areas.features.map(withArea);

  // Operator's polygons stay first/authoritative; model gap-fill appended. The
  // precedence resolver de-conflicts any slight overlaps at the seams.
  const merged: ServiceAreaCollection = {
    type: "FeatureCollection",
    features: [...existing, ...gapfill],
  };

  const cfgRow = await getActiveConfig(prop.company_id);
  if (!cfgRow) throw new Error("No active pricing config.");

  const turf_sqft = roundSqft(computeEffectiveTurf(merged, false));
  const bed_sqft = roundSqft(computeNetAreas(merged, false).bed);

  const mapView = m?.map_view ?? pred.map_view;
  const [meas] = await db
    .insert(schema.measurement)
    .values({
      property_id: prop.id,
      turf_sqft,
      bed_sqft,
      complexity: "1.00",
      confidence: "Low", // model-completed draft — needs review
      source: "ml_pred",
      service_areas: merged,
      map_view: mapView,
    })
    .returning();

  const result = computePricing(
    { turf_sqft, bed_sqft, complexity: 1.0, confidence: "Low" },
    toEngineConfig(cfgRow)
  );
  await db.insert(schema.pricingResult).values({
    property_id: prop.id,
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

  const byKind: Record<string, number> = {};
  for (const f of gapfill) byKind[f.properties.kind] = (byKind[f.properties.kind] ?? 0) + 1;
  console.log(
    `Completed "${prop.name}": kept ${existing.length} of your polygons, added ${gapfill.length} ` +
      `model gap-fill (${JSON.stringify(byKind)}).`
  );
  console.log(`Mowable turf now ${turf_sqft.toLocaleString()} sf. Open the property to review & save.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
