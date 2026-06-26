import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import { PNG } from "pngjs";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { fetchParcelTile } from "../lib/integrations/imagery";
import { rasterizeMask, classPixelCounts, CLASS_NAMES } from "../lib/geo/raster";
import type { ParcelResult, ServiceAreaCollection } from "../lib/geo/types";

// Exports labeled measurements into an ML segmentation dataset:
//   training-data/images/<id>.jpg   — satellite tile (parcel bbox)
//   training-data/masks/<id>.png    — class-index mask (R=G=B=classId), aligned
//   training-data/metadata.jsonl    — one row per sample
//   training-data/classes.json      — class index legend
// Image and mask share identical tiling via fetchParcelTile, so they're aligned.
// HF-friendly layout (imagefolder + metadata.jsonl). Run: npm run export:training

const OUT = "training-data";
const token = process.env.MAPBOX_API ?? null;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
const db = drizzle(neon(url), { schema });

function writeMaskPng(path: string, mask: Uint8Array, width: number, height: number) {
  const png = new PNG({ width, height });
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i]; // 0..7 class id, stored in all channels
    png.data[i * 4] = v;
    png.data[i * 4 + 1] = v;
    png.data[i * 4 + 2] = v;
    png.data[i * 4 + 3] = 255;
  }
  return writeFile(path, PNG.sync.write(png));
}

async function main() {
  if (!token) throw new Error("MAPBOX_API is not set (needed to fetch training tiles).");

  await rm(OUT, { recursive: true, force: true });
  await mkdir(`${OUT}/images`, { recursive: true });
  await mkdir(`${OUT}/masks`, { recursive: true });
  await writeFile(
    `${OUT}/classes.json`,
    JSON.stringify({ classes: CLASS_NAMES }, null, 2)
  );

  const allRows = await db
    .select({
      measurement_id: schema.measurement.id,
      property_id: schema.measurement.property_id,
      measured_at: schema.measurement.measured_at,
      service_areas: schema.measurement.service_areas,
      name: schema.property.name,
      icp_type: schema.property.icp_type,
      parcel: schema.property.parcel_geojson,
    })
    .from(schema.measurement)
    .innerJoin(schema.property, eq(schema.measurement.property_id, schema.property.id))
    // Only human-verified labels — never train on the model's own ml_pred drafts.
    .where(
      and(isNotNull(schema.measurement.service_areas), ne(schema.measurement.source, "ml_pred"))
    )
    .orderBy(desc(schema.measurement.measured_at));

  // One sample per property: keep only the latest measurement (re-saves create
  // multiple rows; we don't want near-duplicate training samples).
  const seen = new Set<string>();
  const rows = allRows.filter((r) => {
    if (seen.has(r.property_id)) return false;
    seen.add(r.property_id);
    return true;
  });

  if (!rows.length) {
    console.log(
      "No labeled measurements yet. Open each property on the map, draw the\n" +
        "service areas (turf/bed/tree/building/parking/…) and Save — then re-run\n" +
        "this export. Each saved measurement becomes one labeled training sample."
    );
    return;
  }

  let n = 0;
  for (const r of rows) {
    if (!r.parcel) {
      console.log(`  skip (no parcel): ${r.name}`);
      continue;
    }
    const tile = await fetchParcelTile(r.parcel as ParcelResult, token);
    if (!tile) {
      console.log(`  skip (no tile): ${r.name}`);
      continue;
    }
    const mask = rasterizeMask(r.service_areas as ServiceAreaCollection, {
      minLng: tile.minLng,
      minLat: tile.minLat,
      maxLng: tile.maxLng,
      maxLat: tile.maxLat,
      width: tile.width,
      height: tile.height,
    });
    const id = r.measurement_id;
    await writeFile(`${OUT}/images/${id}.jpg`, tile.jpeg);
    await writeMaskPng(`${OUT}/masks/${id}.png`, mask, tile.width, tile.height);
    const counts = classPixelCounts(mask);
    await appendFile(
      `${OUT}/metadata.jsonl`,
      JSON.stringify({
        file_name: `images/${id}.jpg`,
        mask: `masks/${id}.png`,
        property: r.name,
        icp_type: r.icp_type,
        width: tile.width,
        height: tile.height,
        class_pixel_counts: Object.fromEntries(CLASS_NAMES.map((c, i) => [c, counts[i]])),
      }) + "\n"
    );
    n++;
    console.log(`  exported: ${r.name} (${tile.width}x${tile.height})`);
  }
  console.log(`\nDone. ${n} training sample(s) in ./${OUT}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
