// Residential package builder: bundle unpackaged leads by subdivision (falling
// back to ZIP), price each bundle through the quality-weighted economics
// engine, and create DRAFT packages for operator review — publishing is the
// operator's explicit approval, same posture as campaign sends. Shared by the
// weekly cron (/api/cron/residential) and scripts/build-residential-packages.

import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { buildPackageTeaser } from "../residential/teaser";
import { MIN_PACKAGE_LEADS, pricePackage } from "../residential/economics";
import { notifyBuyersOfPackagePublish } from "../residential/alerts";

// 2026-07-24 self-feeding shelf (operator: "yes lets go"): FRESH packages
// auto-publish — the week the shelf went stale, every reachable company had
// been pitched everything and volume starved at the top of a working
// pipeline. A package whose newest sale is recent enough that the pitch's
// "just bought" claim is TRUE publishes itself; anything staler stays a
// draft for operator judgment. Kill switch: RESI_AUTO_PUBLISH=0.
const AUTO_PUBLISH_MAX_AGE_DAYS = 30;
/** Published packages whose NEWEST sale is older than this get archived —
 *  the sample dates in the pitch would advertise their staleness. */
const ARCHIVE_AFTER_DAYS = 60;

export type ResidentialPackagingSummary = {
  leads: number;
  packages: number;
  published: number;
  archived: number;
  held: number;
  log: string[];
};

/** Archive published packages whose newest member sale has gone stale. Their
 *  unlock/report pages keep working; they just stop being pitched or sold. */
export async function archiveStalePackages(log: string[]): Promise<number> {
  const cutoff = new Date(Date.now() - ARCHIVE_AFTER_DAYS * 86400_000);
  const rows = await db
    .select({
      id: schema.residentialPackage.id,
      name: schema.residentialPackage.name,
      newest: sql<string | null>`max(${schema.residentialLead.signal_date})`,
    })
    .from(schema.residentialPackage)
    .innerJoin(
      schema.residentialPackageMembership,
      eq(schema.residentialPackageMembership.package_id, schema.residentialPackage.id)
    )
    .innerJoin(
      schema.residentialLead,
      eq(schema.residentialPackageMembership.residential_lead_id, schema.residentialLead.id)
    )
    .where(eq(schema.residentialPackage.status, "published"))
    .groupBy(schema.residentialPackage.id, schema.residentialPackage.name);
  const stale = rows.filter((r) => !r.newest || new Date(r.newest) < cutoff);
  if (stale.length === 0) return 0;
  await db
    .update(schema.residentialPackage)
    .set({ status: "archived", updated_at: new Date() })
    .where(inArray(schema.residentialPackage.id, stale.map((r) => r.id)));
  for (const r of stale) {
    log.push(`  ⌛ archived ${r.name} — newest sale ${r.newest?.slice(0, 10) ?? "unknown"} is past ${ARCHIVE_AFTER_DAYS}d`);
  }
  return stale.length;
}

export async function runResidentialPackaging(): Promise<ResidentialPackagingSummary> {
  const log: string[] = [];
  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found. Run `npm run db:seed` first.");

  // Retire what's gone stale before shelving what's fresh.
  const archived = await archiveStalePackages(log).catch(() => 0);

  const leads = await db
    .select()
    .from(schema.residentialLead)
    .where(inArray(schema.residentialLead.status, ["sourced", "qualified"]));
  if (leads.length === 0) {
    log.push("No unpackaged residential leads.");
    return { leads: 0, packages: 0, published: 0, archived, held: 0, log };
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

  // FRESH-CITY rollup (2026-07-24: ZIP fragmentation left every bundle under
  // the floor and the shelf EMPTY). Fresh leads (sale ≤45d) stuck in thin
  // ZIP bundles combine into one city-wide bundle — a fresh multi-ZIP city
  // list is an honest product ("just bought in Fort Worth" is true). STALE
  // leads stay held: the operator's standing hold on catch-all packaging of
  // old leads applies to them, not to fresh supply.
  const FRESH_ROLLUP_DAYS = 45;
  const CITYFRESH = "|CITYFRESH";
  const ageDays = (d: Date | null) => (d ? (Date.now() - d.getTime()) / 86400_000 : 999);
  for (const [key, list] of [...groups.entries()]) {
    if (list.length >= MIN_PACKAGE_LEADS || key.endsWith(CITYFRESH)) continue;
    const stay: schema.ResidentialLead[] = [];
    for (const lead of list) {
      const isFresh = !!lead.signal_date && ageDays(lead.signal_date) <= FRESH_ROLLUP_DAYS;
      if (isFresh && lead.city) {
        const ck = `c:${lead.city.toLowerCase()}${CITYFRESH}`;
        groups.set(ck, [...(groups.get(ck) ?? []), lead]);
      } else {
        stay.push(lead);
      }
    }
    if (stay.length) groups.set(key, stay);
    else groups.delete(key);
  }
  log.push(`${leads.length} lead(s) across ${groups.size} candidate bundle(s)`);
  if (unplaceable) log.push(`${unplaceable} lead(s) held — no ZIP or city to label a report with`);

  let packages = 0;
  let published = 0;
  let held = 0;

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
    // A CITYFRESH rollup spans many ZIPs — its honest label is the city.
    const isCityFresh = key.endsWith(CITYFRESH);
    const zip = isCityFresh ? null : groupLeads[0].zip;
    const city = groupLeads[0].city;
    // A GEOBUNDLE spans many subdivisions — naming it after the first lead's
    // subdivision would mislabel the product. Only subdivision-keyed groups
    // carry the subdivision name.
    const isBundle = key.endsWith(BUNDLE);
    const sub =
      isBundle || isCityFresh || /^abst\b/i.test(groupLeads[0].subdivision_name ?? "")
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

    // Auto-publish when the newest sale is fresh enough that the pitch's
    // "just bought" claim is literally true; staler bundles stay drafts for
    // the operator. Publish alerts (radius-gated buyer emails) fire on the
    // same path the manual publish button uses.
    const newest = groupLeads.reduce<Date | null>(
      (a, l) => (l.signal_date && (!a || l.signal_date > a) ? l.signal_date : a),
      null
    );
    const fresh = newest ? ageDays(newest) <= AUTO_PUBLISH_MAX_AGE_DAYS : false;
    if (fresh && process.env.RESI_AUTO_PUBLISH !== "0") {
      await db
        .update(schema.residentialPackage)
        .set({ status: "published", updated_at: new Date() })
        .where(eq(schema.residentialPackage.id, pkg.id));
      published++;
      await notifyBuyersOfPackagePublish(pkg.id).catch(() => null);
      log.push(
        `  ✓ ${name} — ${groupLeads.length} addresses, $${Math.round(pricing.price_cents / 100)} — PUBLISHED (newest sale ${newest?.toISOString().slice(0, 10)})`
      );
    } else {
      log.push(
        `  ✓ ${name} — ${groupLeads.length} addresses, $${Math.round(pricing.price_cents / 100)} — draft (newest sale ${newest ? newest.toISOString().slice(0, 10) : "unknown"})`
      );
    }
  }
  held += unplaceable;
  if (held) log.push(`${held} lead(s) held for next cycle (thin bundles).`);
  return { leads: leads.length, packages, published, archived, held, log };
}
