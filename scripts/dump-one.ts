import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { mkdir, writeFile, rm } from "node:fs/promises";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { fetchParcelTile } from "../lib/integrations/imagery";
import type { ParcelResult, ServiceAreaCollection } from "../lib/geo/types";

// Gap-fill helper: dump ONE property (by name) for the predictor even though it's
// already partially labeled, INCLUDING the operator's existing polygons. The
// Python predictor uses those to fill only the areas the operator hasn't drawn,
// and the completion step merges the gap-fill back into the operator's work.
//
// Run:  npm run ml:dump-one -- "Woodlands Church"

const name = process.argv.slice(2).join(" ").trim();
if (!name) throw new Error('Usage: npm run ml:dump-one -- "Property Name"');

const OUT = "ml";
const token = process.env.MAPBOX_API ?? null;
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
if (!token) throw new Error("MAPBOX_API is not set.");
const db = drizzle(neon(url), { schema });

function outerRings(p: ParcelResult): number[][][] {
  if (p.geometry.type === "Polygon") return [(p.geometry.coordinates as number[][][])[0]];
  return (p.geometry.coordinates as number[][][][]).map((poly) => poly[0]);
}

async function main() {
  const [p] = await db.select().from(schema.property).where(eq(schema.property.name, name)).limit(1);
  if (!p) throw new Error(`No property named "${name}".`);
  if (!p.parcel_geojson) throw new Error(`"${name}" has no parcel boundary cached.`);

  // Latest human label (not a model draft) — what the operator has drawn so far.
  const [m] = await db
    .select()
    .from(schema.measurement)
    .where(
      and(
        eq(schema.measurement.property_id, p.id),
        isNotNull(schema.measurement.service_areas),
        ne(schema.measurement.source, "ml_pred")
      )
    )
    .orderBy(desc(schema.measurement.measured_at))
    .limit(1);
  const existing = (m?.service_areas as ServiceAreaCollection | null) ?? { type: "FeatureCollection", features: [] };

  const tile = await fetchParcelTile(p.parcel_geojson as ParcelResult, token);
  if (!tile) throw new Error("Could not fetch a satellite tile for this parcel.");

  await rm(`${OUT}/predict_in`, { recursive: true, force: true });
  await mkdir(`${OUT}/predict_in`, { recursive: true });
  await writeFile(`${OUT}/predict_in/${p.id}.jpg`, tile.jpeg);

  const manifest = [
    {
      property_id: p.id,
      name: p.name,
      width: tile.width,
      height: tile.height,
      bbox: { minLng: tile.minLng, minLat: tile.minLat, maxLng: tile.maxLng, maxLat: tile.maxLat },
      parcel_rings: outerRings(p.parcel_geojson as ParcelResult),
      // The predictor fills only where these don't already cover.
      existing_labels: existing,
    },
  ];
  await writeFile(`${OUT}/to_predict.json`, JSON.stringify(manifest, null, 2));
  console.log(
    `Dumped "${p.name}" (${tile.width}x${tile.height}) with ${existing.features.length} existing polygon(s) ` +
      `-> ${OUT}/predict_in, ${OUT}/to_predict.json`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
