import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, isNull } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { fetchParcelAtPoint } from "../lib/integrations/parcel";
import { geocodeAddress } from "../lib/integrations/geocoding";
import { estimateServiceableArea } from "../lib/integrations/imagery";
import { isGrassQualified, MIN_GRASS_FRACTION } from "../lib/sourcing/criteria";
import type { ParcelResult } from "../lib/geo/types";

// Batch sourcing pre-screen: for every property, cheaply estimate the parcel's
// vegetated (≈ grass) share and persist it to property.grass_fraction. The stored
// value lets future scans disregard properties already screened — by default this
// script SKIPS any property that already has a grass_fraction. Pass --force to
// re-screen everything (e.g. after the threshold or imagery changes).
//
// Run:  npm run screen            (only unscreened)
//       npm run screen -- --force (re-screen all)

const force = process.argv.includes("--force");
const token = process.env.MAPBOX_API ?? null;
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
if (!token) throw new Error("MAPBOX_API is not set.");
const db = drizzle(neon(url), { schema });

async function main() {
  const props = await db
    .select()
    .from(schema.property)
    .where(force ? undefined : isNull(schema.property.grass_fraction));

  console.log(
    `Screening ${props.length} propert${props.length === 1 ? "y" : "ies"}` +
      (force ? " (force: re-screening all)" : " (unscreened only)") +
      ` — threshold ${Math.round(MIN_GRASS_FRACTION * 100)}%\n`
  );

  let screened = 0;
  let qualified = 0;
  for (const p of props) {
    // Ensure coordinates.
    let lng = p.lng;
    let lat = p.lat;
    if (lng == null || lat == null) {
      const addr = [p.address, p.city, p.zip, "TX"].filter(Boolean).join(", ");
      const coords = await geocodeAddress(addr);
      if (!coords) {
        console.log(`  skip (no geocode): ${p.name}`);
        continue;
      }
      [lng, lat] = coords;
      await db
        .update(schema.property)
        .set({ lng, lat, updated_at: new Date() })
        .where(eq(schema.property.id, p.id));
    }

    // Ensure parcel.
    let parcel = (p.parcel_geojson as ParcelResult | null) ?? null;
    if (!parcel) {
      parcel = await fetchParcelAtPoint(lng, lat);
      if (parcel) {
        await db
          .update(schema.property)
          .set({ parcel_geojson: parcel, updated_at: new Date() })
          .where(eq(schema.property.id, p.id));
      }
    }
    if (!parcel) {
      console.log(`  skip (no parcel): ${p.name}`);
      continue;
    }

    const est = await estimateServiceableArea(parcel, token);
    if (!est) {
      console.log(`  skip (no imagery): ${p.name}`);
      continue;
    }

    await db
      .update(schema.property)
      .set({ grass_fraction: est.vegetation_fraction, updated_at: new Date() })
      .where(eq(schema.property.id, p.id));

    screened++;
    const qual = isGrassQualified(est.vegetation_fraction);
    if (qual) qualified++;
    const pctLabel = `${Math.round(est.vegetation_fraction * 100)}%`.padStart(4);
    console.log(`  ${qual ? "✓" : "·"} ${pctLabel}  ${p.name}${qual ? "" : "  (below threshold)"}`);
  }

  console.log(`\nDone. Screened ${screened}, qualified ${qualified}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
