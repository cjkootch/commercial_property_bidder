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

  // Group by geography+subdivision; thin subdivision groups fall into their
  // geography bundle (the R0 lesson: a 1-lead "report" is not a product).
  // Geography = ZIP, else city — Tarrant's bulk layer ships blank ZIPs on
  // many rows, and without the city fallback every no-ZIP lead county-wide
  // pooled into ONE bundle mislabeled with the first lead's subdivision.
  // Leads with neither ZIP nor city can't be honestly labeled — held.
  const geoOf = (l: schema.ResidentialLead) =>
    l.zip || (l.city ? `c:${l.city.toLowerCase()}` : null);
  const BUNDLE = "|GEOBUNDLE";
  const bySub = new Map<string, schema.ResidentialLead[]>();
  let unplaceable = 0;
  for (const lead of leads) {
    const geo = geoOf(lead);
    if (!geo) {
      unplaceable++;
      continue;
    }
    // HCAD abstract-tract legals ("ABST 69 C SMITH") aren't subdivisions a
    // buyer would recognize — group them by geography instead.
    const subName =
      lead.subdivision_name && !/^abst\b/i.test(lead.subdivision_name)
        ? lead.subdivision_name
        : null;
    const key = `${geo}|${subName || "nosub"}`;
    const list = bySub.get(key) ?? [];
    list.push(lead);
    bySub.set(key, list);
  }
  const groups = new Map<string, schema.ResidentialLead[]>();
  for (const [key, list] of bySub.entries()) {
    const finalKey = list.length >= MIN_PACKAGE_LEADS ? key : `${geoOf(list[0])}${BUNDLE}`;
    groups.set(finalKey, [...(groups.get(finalKey) ?? []), ...list]);
  }
  log.push(`${leads.length} lead(s) across ${groups.size} candidate bundle(s)`);
  if (unplaceable) log.push(`${unplaceable} lead(s) held — no ZIP or city to label a report with`);

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
    const city = groupLeads[0].city;
    // A GEOBUNDLE spans many subdivisions — naming it after the first lead's
    // subdivision would mislabel the product. Only subdivision-keyed groups
    // carry the subdivision name.
    const isBundle = key.endsWith(BUNDLE);
    const sub =
      isBundle || /^abst\b/i.test(groupLeads[0].subdivision_name ?? "")
        ? null
        : groupLeads[0].subdivision_name;
    // ZIP in the bundle name: two ZIP bundles in one city otherwise collide
    // ("Houston Residential New Mover Report" x2 on the shelf).
    const geoName = city && zip ? `${city} ${zip}` : city || zip;
    const name = sub
      ? `${sub} Residential Opportunity Report`
      : `${geoName} Residential New Mover Report`;

    const [pkg] = await db
      .insert(schema.residentialPackage)
      .values({
        company_id: co.id,
        name,
        geography_label: sub ? `${sub} / ${city}` : geoName,
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
  held += unplaceable;
  if (held) log.push(`${held} lead(s) held for next cycle (thin bundles).`);
  return { leads: leads.length, packages, held, log };
}
