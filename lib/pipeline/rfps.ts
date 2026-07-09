// Public grounds/landscaping bid sourcing (Bonfire procurement portals),
// shared by the CLI (scripts/source-rfps) and the weekly cron (/api/cron/rfps):
// a government agency taking bids on a mowing/landscaping contract is
// pre-qualified demand with a hard deadline — the highest-ticket, lowest-cost
// leads on the shelf (no geocoding, no parcel, no imagery).
//
// Source: Bonfire's public portal JSON (verified live 2026-07-08):
//   GET https://<org>.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData
//   - plain JSON, no auth: ProjectID, ReferenceID, ProjectName, DateClose
//   - Harris County alone has run ~58 grounds solicitations historically
//     (right-of-way mowing ITBs, Flood Control regional mowing, clinic
//     landscaping); the sibling portals add cadence for free.
//
// RFP leads are different from property leads and the pipeline treats them so:
//   - no parcel/imagery — the deliverable is the solicitation itself
//   - "Bids close YYYY-MM-DD" in the notes is the deadline; the daily
//     pipeline cron ARCHIVES rfp leads past their close date (expireRfpLeads)
//     because an expired solicitation is worth nothing.

import { and, isNull, like, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { currentMarket } from "../markets";

/** The market's Bonfire portals (lib/markets registry — verified to serve
 *  the public JSON for Houston; verify per metro when adding one). */
export const BONFIRE_PORTALS: { slug: string; agency: string; city: string }[] =
  currentMarket().bonfirePortals;

/** A solicitation is ours if the title reads like grounds/landscape work. */
const KEYWORDS =
  /landscap|mowing|\bmow\b|grounds\s*maint|lawn|turf|irrigat|tree\s*(trim|remov|maint)|vegetation\s*manage/i;
/** ...but not professional-services solicitations (design, not doing). */
const EXCLUDE = /architect|engineering\s*services|\bdesign\b/i;

export type RfpRow = {
  portal: string;
  agency: string;
  city: string;
  projectId: string;
  referenceId: string;
  title: string;
  closesIso: string | null; // YYYY-MM-DD
  url: string;
};

type BonfireProject = {
  ProjectID?: string;
  ReferenceID?: string;
  ProjectName?: string;
  DateClose?: string;
};

export function keepRfp(title: string): boolean {
  return KEYWORDS.test(title) && !EXCLUDE.test(title);
}

/** Fetch open grounds-relevant solicitations from one portal. */
export async function fetchPortalRfps(portal: {
  slug: string;
  agency: string;
  city: string;
}): Promise<RfpRow[]> {
  const res = await fetch(
    `https://${portal.slug}.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData`,
    { headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" } }
  );
  if (!res.ok) throw new Error(`Bonfire ${portal.slug} fetch failed: ${res.status}`);
  const data = (await res.json()) as {
    payload?: { projects?: Record<string, BonfireProject> };
  };
  const projects = Object.values(data.payload?.projects ?? {});
  return projects
    .filter((p) => p.ProjectID && p.ProjectName && keepRfp(p.ProjectName))
    .map((p) => ({
      portal: portal.slug,
      agency: portal.agency,
      city: portal.city,
      projectId: String(p.ProjectID),
      referenceId: (p.ReferenceID ?? "").trim(),
      title: (p.ProjectName ?? "").trim(),
      closesIso: p.DateClose ? p.DateClose.slice(0, 10) : null,
      url: `https://${portal.slug}.bonfirehub.com/opportunities/${p.ProjectID}`,
    }));
}

/** Pipeline notes. "Bids close YYYY-MM-DD" is the deadline the marketplace
 *  rank and the expiry sweep both read. The portal URL ships in the unlock —
 *  it's public information; the value is finding it in time. */
export function rfpNotes(r: RfpRow): string {
  return (
    `Public bid ${r.referenceId || r.projectId}: ${r.title}. ` +
    `${r.agency} is taking bids on this grounds/landscaping contract` +
    (r.closesIso ? ` — Bids close ${r.closesIso}.` : ".") +
    ` Solicitation: ${r.url}.` +
    ` Owner: ${r.agency}.`
  );
}

export type RfpRunSummary = {
  scanned: number;
  candidates: number;
  added: number;
  log: string[];
};

export async function runRfpSourcing(opts?: { want?: number }): Promise<RfpRunSummary> {
  const want = opts?.want ?? 10;
  const log: string[] = [];

  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found. Run `npm run db:seed` first.");

  let scanned = 0;
  const candidates: RfpRow[] = [];
  for (const portal of BONFIRE_PORTALS) {
    try {
      const rows = await fetchPortalRfps(portal);
      scanned++;
      candidates.push(...rows);
      log.push(`${portal.agency}: ${rows.length} grounds solicitation(s) open`);
    } catch (e) {
      log.push(`${portal.agency}: fetch failed (${e instanceof Error ? e.message : "error"})`);
    }
  }

  const existing = await db.select({ name: schema.property.name }).from(schema.property);
  const haveName = new Set(existing.map((r) => r.name.trim().toLowerCase()));

  const today = new Date().toISOString().slice(0, 10);
  let added = 0;
  for (const r of candidates) {
    if (added >= want) break;
    if (r.closesIso && r.closesIso < today) continue; // already closed
    const name = `${r.title.slice(0, 120)} (RFP ${r.portal}-${r.projectId})`;
    if (haveName.has(name.trim().toLowerCase())) continue;

    await db.insert(schema.property).values({
      company_id: co.id,
      name,
      // The "address" is the agency — a public contract has a site LIST in
      // the solicitation documents, not a single parcel.
      address: r.agency,
      city: r.city,
      zip: null,
      lat: null,
      lng: null,
      icp_type: "other",
      owner_org: null,
      source: "places",
      status: "sourced",
      parcel_geojson: null,
      grass_fraction: null,
      lead_teaser: null,
      notes: rfpNotes(r),
    });
    haveName.add(name.trim().toLowerCase());
    added++;
    log.push(`added [${r.agency}] ${r.title.slice(0, 80)} — closes ${r.closesIso ?? "?"}`);
  }

  return { scanned, candidates: candidates.length, added, log };
}

/**
 * Archive rfp leads whose bid deadline has passed — run by the daily pipeline
 * cron. An expired solicitation must never sit on the shelf looking sellable.
 */
export async function expireRfpLeads(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({ id: schema.property.id, notes: schema.property.notes })
    .from(schema.property)
    .where(and(like(schema.property.name, "%(RFP %"), isNull(schema.property.archived_at)));
  let expired = 0;
  for (const r of rows) {
    const closes = r.notes?.match(/Bids close (\d{4}-\d{2}-\d{2})/)?.[1];
    if (closes && closes < today) {
      await db
        .update(schema.property)
        .set({ archived_at: sql`now()` })
        .where(sql`${schema.property.id} = ${r.id}`);
      expired++;
    }
  }
  return expired;
}
