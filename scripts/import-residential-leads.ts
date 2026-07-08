import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "../lib/db/schema";
import { and, eq } from "drizzle-orm";
import * as fs from "fs";

// Residential CSV import script.
// Run: npm run residential:import -- path/to/leads.csv

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: npm run residential:import -- <path_to_csv>");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
const db = drizzle(neon(url), { schema });

async function main() {
  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found. Run `npm run db:seed` first.");

  const content = fs.readFileSync(csvPath, "utf-8");
  const lines = content.split("\n");
  const header = lines[0].split(",").map((h) => h.trim());

  const leads = lines.slice(1).filter((l) => l.trim().length > 0);
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const line of leads) {
    try {
      const values = line.split(",").map((v) => v.trim());
      const row: any = {};
      header.forEach((col, i) => {
        row[col] = values[i];
      });

      // Validate required fields
      if (!row.address || !row.zip || !row.signal_type) {
        console.error(`  · Skipping invalid row: ${line}`);
        errors++;
        continue;
      }

      // Normalize signal_type, source, confidence
      const signalType = row.signal_type as any;
      const source = (row.source || "import_csv") as any;
      const confidence = (row.confidence || "Med") as any;

      // Check for duplicates
      const existing = await db
        .select()
        .from(schema.residentialLead)
        .where(
          and(
            eq(schema.residentialLead.address, row.address),
            eq(schema.residentialLead.zip, row.zip),
            eq(schema.residentialLead.signal_type, signalType)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      await db.insert(schema.residentialLead).values({
        company_id: co.id,
        address: row.address,
        city: row.city,
        state: row.state,
        zip: row.zip,
        lat: row.lat ? parseFloat(row.lat) : null,
        lng: row.lng ? parseFloat(row.lng) : null,
        subdivision_name: row.subdivision_name,
        builder_name: row.builder_name,
        signal_type: signalType,
        signal_date: row.signal_date ? new Date(row.signal_date) : new Date(),
        source: source,
        estimated_home_value: row.estimated_home_value ? parseInt(row.estimated_home_value) : null,
        lot_size_sqft: row.lot_size_sqft ? parseFloat(row.lot_size_sqft) : null,
        year_built: row.year_built ? parseInt(row.year_built) : null,
        confidence: confidence,
        notes: row.notes,
        status: "sourced",
      });

      inserted++;
    } catch (e) {
      console.error(`  · Error processing row: ${line}`, e);
      errors++;
    }
  }

  console.log(`\nImport complete:`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped (duplicate): ${skipped}`);
  console.log(`  Errors: ${errors}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
