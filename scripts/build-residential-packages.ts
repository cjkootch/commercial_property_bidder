import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "../lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { buildPackageTeaser } from "../lib/residential/teaser";

// Residential Package Builder script.
// Groups qualified leads by zip and/or subdivision and creates draft packages.
// Run: npm run residential:package

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
const db = drizzle(neon(url), { schema });

async function main() {
  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found. Run `npm run db:seed` first.");

  // Find qualified or sourced residential leads not yet packaged
  const leads = await db
    .select()
    .from(schema.residentialLead)
    .where(inArray(schema.residentialLead.status, ["sourced", "qualified"]));

  if (leads.length === 0) {
    console.log("No unpackaged residential leads found.");
    return;
  }

  // Group by zip + subdivision
  const groups = new Map<string, schema.ResidentialLead[]>();
  for (const lead of leads) {
    const key = `${lead.zip || "nozip"}-${lead.subdivision_name || "nosub"}`;
    const list = groups.get(key) ?? [];
    list.push(lead);
    groups.set(key, list);
  }

  console.log(`Found ${leads.length} leads across ${groups.size} potential packages.`);

  for (const [key, groupLeads] of groups.entries()) {
    const zip = groupLeads[0].zip;
    const sub = groupLeads[0].subdivision_name;
    const city = groupLeads[0].city;

    const name = sub
      ? `${sub} Residential Opportunity Report`
      : `${city || zip} Residential New Mover Report`;

    const teaser = buildPackageTeaser(groupLeads);

    // Create draft package
    const [pkg] = await db.insert(schema.residentialPackage).values({
      company_id: co.id,
      name,
      geography_label: sub ? `${sub} / ${city}` : city || zip,
      zip: zip,
      lead_count: groupLeads.length,
      signal_summary: teaser,
      price_cents: groupLeads.length * 500, // $5 per lead base
      status: "draft",
    }).returning();

    // Attach leads to package
    for (const lead of groupLeads) {
      await db.insert(schema.residentialPackageMembership).values({
        package_id: pkg.id,
        residential_lead_id: lead.id,
      });

      // Update lead status
      await db
        .update(schema.residentialLead)
        .set({ status: "packaged" })
        .where(eq(schema.residentialLead.id, lead.id));
    }

    console.log(`  ✓ Created package: ${name} (${groupLeads.length} leads)`);
  }

  console.log("\nPackage building complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
