import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { mkdir, writeFile, rm } from "node:fs/promises";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { isNotNull } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { fetchParcelTile } from "../lib/integrations/imagery";
import type { ParcelResult } from "../lib/geo/types";

// Step 1 of the self-training loop: for every property that has a parcel but no
// human label yet, fetch its satellite tile and write it + geometry to ml/ so
// the Python predictor can pre-label turf. TS owns networking; Python stays
// offline.

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
  // Properties that already have a human label (service_areas from a non-ml_pred
  // measurement) — skip these.
  const labeled = new Set(
    (
      await db
        .select({ pid: schema.measurement.property_id, source: schema.measurement.source })
        .from(schema.measurement)
        .where(isNotNull(schema.measurement.service_areas))
    )
      .filter((r) => r.source !== "ml_pred")
      .map((r) => r.pid)
  );

  const props = await db
    .select()
    .from(schema.property)
    .where(isNotNull(schema.property.parcel_geojson));

  await rm(`${OUT}/predict_in`, { recursive: true, force: true });
  await mkdir(`${OUT}/predict_in`, { recursive: true });

  const manifest: unknown[] = [];
  for (const p of props) {
    if (labeled.has(p.id)) {
      console.log(`  skip (already labeled): ${p.name}`);
      continue;
    }
    const tile = await fetchParcelTile(p.parcel_geojson as ParcelResult, token);
    if (!tile) {
      console.log(`  skip (no tile): ${p.name}`);
      continue;
    }
    await writeFile(`${OUT}/predict_in/${p.id}.jpg`, tile.jpeg);
    manifest.push({
      property_id: p.id,
      name: p.name,
      width: tile.width,
      height: tile.height,
      bbox: { minLng: tile.minLng, minLat: tile.minLat, maxLng: tile.maxLng, maxLat: tile.maxLat },
      parcel_rings: outerRings(p.parcel_geojson as ParcelResult),
    });
    console.log(`  dumped: ${p.name} (${tile.width}x${tile.height})`);
  }

  await writeFile(`${OUT}/to_predict.json`, JSON.stringify(manifest, null, 2));
  console.log(`\nWrote ${manifest.length} tiles -> ${OUT}/predict_in, manifest -> ${OUT}/to_predict.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
