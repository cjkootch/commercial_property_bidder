// Residential package builder: bundle unpackaged leads by subdivision (falling
// back to ZIP), price each bundle through the quality-weighted economics
// engine, and create DRAFT packages for operator review — publishing is the
// operator's explicit approval, same posture as campaign sends. Shared by the
// weekly cron (/api/cron/residential) and scripts/build-residential-packages.

import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { buildPackageTeaser } from "../residential/teaser";
import { MIN_PACKAGE_LEADS, pricePackage } from "../residential/economics";

export type ResidentialPackagingSummary = {
  leads: number;
  packages: number;
  held: number;
  log: string[];
};

export async function runResidentialPackaging(): Promise<ResidentialPackagingSummary> {
  const log: string[] = [];
  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found. Run `npm run db:seed` first.");

  const leads = await db
    .select()
    .from(schema.residentialLead)
    .where(inArray(schema.residentialLead.status, ["sourced", "qualified"]));
  if (leads.length === 0) {
    log.push("No unpackaged residential leads.");
    return { leads: 0, packages: 0, held: 0, log };
  }

  // Group by zip+subdivision; thin subdivision groups fall into their ZIP
  // bundle (the R0 lesson: a 1-lead "report" is not a product).
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
  log.push(`${leads.length} lead(s) across ${groups.size} candidate bundle(s)`);

  let packages = 0;
  let held = 0;
  const ageDays = (d: Date | null) => (d ? (Date.now() - d.getTime()) / 86400_000 : 999);

  for (const [key, groupLeads] of groups.entries()) {
    const pricing = pricePackage(
      groupLeads.map((l) => ({
        signalType: l.signal_type,
        confidence: l.confidence,
        ageDays: ageDays(l.signal_date),
      }))
    );
    if (!pricing.sellable) {
      held += groupLeads.length;
      log.push(`  · held ${groupLeads.length} in ${key} — under the ${MIN_PACKAGE_LEADS}-address floor`);
      continue;
    }
    const zip = groupLeads[0].zip;
    const sub = groupLeads[0].subdivision_name;
    const city = groupLeads[0].city;
    const name = sub
      ? `${sub} Residential Opportunity Report`
      : `${city || zip} Residential New Mover Report`;

    const [pkg] = await db
      .insert(schema.residentialPackage)
      .values({
        company_id: co.id,
        name,
        geography_label: sub ? `${sub} / ${city}` : city || zip,
        zip,
        lead_count: groupLeads.length,
        signal_summary: buildPackageTeaser(groupLeads),
        price_cents: pricing.price_cents,
        status: "draft",
      })
      .returning();
    for (const lead of groupLeads) {
      await db.insert(schema.residentialPackageMembership).values({
        package_id: pkg.id,
        residential_lead_id: lead.id,
      });
      await db
        .update(schema.residentialLead)
        .set({ status: "packaged", updated_at: new Date() })
        .where(eq(schema.residentialLead.id, lead.id));
    }
    packages++;
    log.push(
      `  ✓ ${name} — ${groupLeads.length} addresses, $${Math.round(pricing.price_cents / 100)}`
    );
  }
  if (held) log.push(`${held} lead(s) held for next cycle (thin bundles).`);
  return { leads: leads.length, packages, held, log };
}
