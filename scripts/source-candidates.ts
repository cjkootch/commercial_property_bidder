import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "../lib/db/schema";
import { searchCommercialPois, type PoiCandidate } from "../lib/integrations/osm";
import { fetchParcelAtPoint } from "../lib/integrations/parcel";
import { estimateServiceableArea } from "../lib/integrations/imagery";
import { isGrassQualified, MIN_GRASS_FRACTION } from "../lib/sourcing/criteria";

// Autonomous sourcing: discover commercial candidates in the NW-Houston corridor
// (OSM POIs of grass-likely ICP types), run the cheap grass pre-screen on each,
// and insert the first N that PASS as 'sourced' properties with grass_fraction +
// parcel cached. These become ready-to-label ML training properties.
//
// Run:  npm run source            (default: 10 qualified)
//       npm run source -- 5 0.40  (want 5, threshold 0.40)

const WANT = Number(process.argv[2]) || 10;
const THRESHOLD = Number(process.argv[3]) || MIN_GRASS_FRACTION;
const MAX_LOOKUPS = 120; // bound county-GIS + imagery calls

// NW-Houston corridor: Tomball / Cypress / Spring / Magnolia. [S, W, N, E]
const BBOX: [number, number, number, number] = [29.95, -95.95, 30.30, -95.45];

const token = process.env.MAPBOX_API ?? null;
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
if (!token) throw new Error("MAPBOX_API is not set.");
const db = drizzle(neon(url), { schema });

// Deterministic-ish shuffle so reruns explore different candidates first.
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

  console.log(`Discovering commercial POIs in NW Houston (bbox ${BBOX.join(",")})…`);
  const pois = await searchCommercialPois(BBOX);
  console.log(`  found ${pois.length} named POIs; screening up to ${MAX_LOOKUPS} for ≥${Math.round(THRESHOLD * 100)}% grass\n`);

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
      icp_type: p.icp_type,
      source: "places",
      status: "sourced",
      parcel_geojson: parcel,
      grass_fraction: frac,
    });
    have.add(p.name.trim().toLowerCase());
    qualified.push({ name: p.name, pct: Math.round(frac * 100) });
    console.log(`  ✓  ${`${Math.round(frac * 100)}%`.padStart(4)} ADDED  ${p.name} [${p.icp_type}]`);
  }

  console.log(
    `\nDone. Added ${qualified.length}/${WANT} qualified propert${qualified.length === 1 ? "y" : "ies"} ` +
      `after ${lookups} screen(s). Open them on the map to draw labels, then \`npm run export:training\`.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
