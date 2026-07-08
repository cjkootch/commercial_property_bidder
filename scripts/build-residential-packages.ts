import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "../lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { buildPackageTeaser } from "../lib/residential/teaser";
import { MIN_PACKAGE_LEADS, pricePackage } from "../lib/residential/economics";

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

  // Group by zip + subdivision; subdivision groups below MIN_PACKAGE_LEADS
  // fall back into their ZIP bundle (the R0 lesson: a 1-lead "report" is not
  // a product), and ZIP bundles still under the floor are HELD for the next
  // cycle rather than shipped thin.
  const bySub = new Map<string, schema.ResidentialLead[]>();
  for (const lead of leads) {
    const key = `${lead.zip || "nozip"}-${lead.subdivision_name || "nosub"}`;
    const list = bySub.get(key) ?? [];
    list.push(lead);
    bySub.set(key, list);
  }
  const groups = new Map<string, schema.ResidentialLead[]>();
  for (const [key, list] of bySub.entries()) {
    const finalKey = list.length >= MIN_PACKAGE_LEADS ? key : `${list[0].zip || "nozip"}-ZIPBUNDLE`;
    groups.set(finalKey, [...(groups.get(finalKey) ?? []), ...list]);
  }

  console.log(`Found ${leads.length} leads across ${groups.size} potential packages.`);
  let held = 0;

  for (const [key, groupLeads] of groups.entries()) {
    // Economics gate: thin bundles wait for next cycle's flow.
    const ageDays = (d: Date | null) => (d ? (Date.now() - d.getTime()) / 86400_000 : 999);
    const pricing = pricePackage(
      groupLeads.map((l) => ({
        signalType: l.signal_type,
        confidence: l.confidence,
        ageDays: ageDays(l.signal_date),
      }))
    );
    if (!pricing.sellable) {
      held += groupLeads.length;
      console.log(`  · held ${groupLeads.length} lead(s) in ${key} — under the ${MIN_PACKAGE_LEADS}-address floor`);
      continue;
    }
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
      // Quality-weighted pricing (lib/residential/economics): volume, signal
      // strength, and freshness all move price through one lever.
      price_cents: pricing.price_cents,
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

    console.log(`  ✓ Created package: ${name} (${groupLeads.length} leads, $${(pricing.price_cents / 100).toFixed(0)}, quality ${pricing.quality})`);
  }

  if (held) console.log(`\n${held} lead(s) held for the next cycle (thin bundles).`);
  console.log("\nPackage building complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
