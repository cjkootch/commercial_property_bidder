import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "../lib/db/schema";
import { searchResidentialPois, type PoiCandidate } from "../lib/integrations/osm";
import { fetchParcelAtPoint } from "../lib/integrations/parcel";
import { estimateServiceableArea } from "../lib/integrations/imagery";
import { isGrassQualified, MIN_GRASS_FRACTION } from "../lib/sourcing/criteria";

// Residential sourcing: discover addressed homes in a tight neighborhood bbox,
// grass pre-screen each, and insert qualified ones as 'sourced' residential
// properties — fine-detail training targets (small lawns, beds, driveways).
//
// Run:  npm run source:residential            (default: 5 qualified)
//       npm run source:residential -- 8 0.30

const WANT = Number(process.argv[2]) || 5;
const THRESHOLD = Number(process.argv[3]) || MIN_GRASS_FRACTION;
const MAX_LOOKUPS = 120;

// A TIGHT, well-mapped residential neighborhood box (The Woodlands). [S, W, N, E]
// (building footprints are dense — keep this small so Overpass stays fast.)
const BBOX: [number, number, number, number] = [30.16, -95.52, 30.18, -95.49];

const token = process.env.MAPBOX_API ?? null;
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
if (!token) throw new Error("MAPBOX_API is not set.");
const db = drizzle(neon(url), { schema });

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function main() {
  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found. Run `npm run db:seed` first.");

  const existing = await db.select({ name: schema.property.name }).from(schema.property);
  const have = new Set(existing.map((r) => r.name.trim().toLowerCase()));

  console.log(`Discovering residential homes in ${BBOX.join(",")}…`);
  const pois = await searchResidentialPois(BBOX);
  console.log(`  found ${pois.length} addressed homes; screening up to ${MAX_LOOKUPS} for ≥${Math.round(THRESHOLD * 100)}% grass\n`);

  const candidates: PoiCandidate[] = shuffle(pois).filter((p) => !have.has(p.name.trim().toLowerCase()));

  const qualified: { name: string; pct: number }[] = [];
  let lookups = 0;
  for (const p of candidates) {
    if (qualified.length >= WANT || lookups >= MAX_LOOKUPS) break;
    lookups++;

    const parcel = await fetchParcelAtPoint(p.lng, p.lat);
    if (!parcel) {
      console.log(`  ·  no parcel    ${p.name}`);
      continue;
    }
    const est = await estimateServiceableArea(parcel, token);
    if (!est) {
      console.log(`  ·  no imagery   ${p.name}`);
      continue;
    }
    const frac = est.vegetation_fraction;
    if (!isGrassQualified(frac, THRESHOLD)) {
      console.log(`  ·  ${`${Math.round(frac * 100)}%`.padStart(4)}        ${p.name}`);
      continue;
    }

    await db.insert(schema.property).values({
      company_id: co.id,
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      icp_type: "residential",
      source: "places",
      status: "sourced",
      parcel_geojson: parcel,
      grass_fraction: frac,
      notes: "Residential fine-detail training target (small lawn/beds/driveway).",
    });
    have.add(p.name.trim().toLowerCase());
    qualified.push({ name: p.name, pct: Math.round(frac * 100) });
    console.log(`  ✓  ${`${Math.round(frac * 100)}%`.padStart(4)} ADDED  ${p.name}`);
  }

  console.log(
    `\nDone. Added ${qualified.length}/${WANT} residential propert${qualified.length === 1 ? "y" : "ies"} ` +
      `after ${lookups} screen(s). Open them on the map, draw turf/bed/tree/driveway in fine detail, then \`npm run export:training\`.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
