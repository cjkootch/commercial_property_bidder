import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { and, eq, isNotNull } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { fetchParcelAtPoint } from "../lib/integrations/parcel";
import type { ParcelResult } from "../lib/geo/types";

// One-off backfill: properties cached their parcel before owner_mailing_address
// was captured. Re-query the county at each property's point and merge ONLY the
// mailing address into the cached parcel (geometry/owner/etc. stay as cached, so
// hand-verified data isn't disturbed).
//
// Run:  npx tsx scripts/backfill-owner-mail.ts

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
const db = drizzle(neon(url), { schema });

async function main() {
  const props = await db
    .select()
    .from(schema.property)
    .where(and(isNotNull(schema.property.parcel_geojson), isNotNull(schema.property.lat)));

  let updated = 0, had = 0, miss = 0;
  for (const p of props) {
    const cached = p.parcel_geojson as ParcelResult;
    if (cached.owner_mailing_address) {
      had++;
      continue;
    }
    if (p.lng == null || p.lat == null) continue;
    const fresh = await fetchParcelAtPoint(p.lng, p.lat);
    const mail = fresh?.owner_mailing_address ?? null;
    if (!mail) {
      miss++;
      console.log(`  ·  no mail    ${p.name}`);
      continue;
    }
    await db
      .update(schema.property)
      .set({
        parcel_geojson: { ...cached, owner_mailing_address: mail },
        updated_at: new Date(),
      })
      .where(eq(schema.property.id, p.id));
    updated++;
    console.log(`  ✓  ${p.name} — ${mail}`);
  }
  console.log(`\nDone. Backfilled ${updated}, already had ${had}, county has none ${miss}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
