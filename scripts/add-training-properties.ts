import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";

// Adds 10 real NW-Houston commercial properties (Harris + Montgomery counties)
// across ICP types, to be labeled via the map workspace as ML training data.
// Idempotent: skips any property whose name already exists. No measurements —
// the operator draws the service areas (= training labels) per property.

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
const db = drizzle(neon(url), { schema });

type Row = {
  name: string;
  address: string;
  city: string;
  zip: string;
  icp_type: (typeof schema.icpTypeEnum.enumValues)[number];
};

const PROPERTIES: Row[] = [
  // Harris County (Tomball / Cypress / Spring)
  { name: "Extra Space Storage — SH-249", address: "23355 State Highway 249", city: "Tomball", zip: "77375", icp_type: "self_storage" },
  { name: "Right Move Storage — FM-2920", address: "19019 FM 2920 Rd", city: "Tomball", zip: "77375", icp_type: "self_storage" },
  { name: "Huffmeister Commons", address: "16712 Huffmeister Rd", city: "Cypress", zip: "77429", icp_type: "office_park" },
  { name: "The Offices at The Rock", address: "13145 Spring Cypress Rd", city: "Cypress", zip: "77429", icp_type: "office_park" },
  { name: "North Cypress Professional Bldg II", address: "21212 Northwest Fwy", city: "Cypress", zip: "77429", icp_type: "medical" },
  { name: "North Cypress Professional Bldg I", address: "21216 Northwest Fwy", city: "Cypress", zip: "77429", icp_type: "medical" },
  { name: "Cypresswood Strip Center", address: "6640 Cypresswood Dr", city: "Spring", zip: "77379", icp_type: "retail_strip" },
  // Montgomery County (Magnolia)
  { name: "Corporate Woods Business Park", address: "331 Corporate Woods Dr", city: "Magnolia", zip: "77354", icp_type: "industrial" },
  { name: "WorkHub FM 1488", address: "33074 Forest West St", city: "Magnolia", zip: "77354", icp_type: "industrial" },
  { name: "Magnolia Bible Church", address: "18525 FM 1488 Rd", city: "Magnolia", zip: "77354", icp_type: "church" },
];

async function main() {
  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found. Run `npm run db:seed` first.");

  const existing = await db.select({ name: schema.property.name }).from(schema.property);
  const have = new Set(existing.map((r) => r.name));

  let added = 0;
  for (const p of PROPERTIES) {
    if (have.has(p.name)) {
      console.log(`  skip (exists): ${p.name}`);
      continue;
    }
    await db.insert(schema.property).values({
      company_id: co.id,
      name: p.name,
      address: p.address,
      city: p.city,
      zip: p.zip,
      icp_type: p.icp_type,
      source: "manual",
      status: "sourced",
    });
    added++;
    console.log(`  added: ${p.name} [${p.icp_type}] — ${p.address}, ${p.city}`);
  }
  console.log(`\nDone. Added ${added} training propert${added === 1 ? "y" : "ies"}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
