// TABC pending-license lead sourcing, shared by the CLI (scripts/source-tabc)
// and the weekly cron (/api/cron/tabc): a business applying for an alcohol
// license is 30–90 days from opening — EARLIER in the timeline than the
// sales-tax registration the openings feed catches, which means the property's
// vendor decisions are still being made when we knock.
//
// Source: Texas open data (SODA), dataset mxm5-tdpj "Pending Original New
// Primary and Subordinate License Application(s)" (verified live 2026-07-08):
//   - updated daily; ~165 pending applications in Harris County
//   - carries owner name, street address, city/zip/county, license type,
//     submission date; NO coordinates (Mapbox geocode required, like openings)
//   - license types: MB mixed beverage (bars/restaurants), BG wine & malt
//     on-premise, BE beer on-premise, N private club, Q/BQ/P off-premise
//     stores. FB is a food-and-beverage CERTIFICATE subordinate to an MB at
//     the same address — skipped so each opening is sourced once.

import { sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { currentMarket, marketByKey } from "../markets";
import { fetchParcelAtPointWithAttrs } from "../integrations/parcel";
import { estimateServiceableArea } from "../integrations/imagery";
import { geocodeWithZip, getMapboxToken } from "../integrations/geocoding";
import { sizeLead } from "../leads/sizing";
import { getActiveConfig, toEngineConfig } from "../db/queries";
import { isGrassQualified, SIGNAL_MIN_GRASS_FRACTION } from "../sourcing/criteria";
import { loadRejects, recordReject } from "./rejects";
import { titleCase } from "./transfers";
import type { ParcelResult } from "../geo/types";

const SODA_URL = "https://data.texas.gov/resource/mxm5-tdpj.json";

/** Primary retail license types = a real storefront opening. */
const LICENSE_ALLOW = new Set(["MB", "BG", "BE", "N", "Q", "BQ", "P"]);

export type TabcRow = {
  applicationId: string;
  licenseType: string;
  owner: string;
  address: string;
  city: string;
  zip: string | null;
  submittedIso: string | null; // YYYY-MM-DD
};

type SodaRecord = {
  applicationid?: string;
  license_type?: string;
  owner?: string;
  address?: string;
  city?: string;
  zip?: string;
  submission_date?: string;
};

export function normalizeTabc(r: SodaRecord): TabcRow | null {
  // applicationid arrives as "585211.0" — strip the float artifact.
  const applicationId = (r.applicationid ?? "").replace(/\.0$/, "").trim();
  const owner = (r.owner ?? "").trim();
  const address = (r.address ?? "").trim();
  const city = (r.city ?? "").trim();
  const licenseType = (r.license_type ?? "").trim().toUpperCase();
  if (!applicationId || !owner || !address || !city) return null;
  if (!LICENSE_ALLOW.has(licenseType)) return null;
  return {
    applicationId,
    licenseType,
    owner,
    address: titleCase(address),
    city: titleCase(city),
    zip: (r.zip ?? "").slice(0, 5) || null,
    submittedIso: r.submission_date ? r.submission_date.slice(0, 10) : null,
  };
}

/** Fetch pending original applications for a market's counties. */
export async function fetchPendingTabc(opts?: {
  counties?: string[];
  limit?: number;
}): Promise<TabcRow[]> {
  const counties = opts?.counties ?? currentMarket().tabcCounties;
  const inList = counties.map((c) => `'${c.toUpperCase()}'`).join(",");
  const params = new URLSearchParams({
    $where: `upper(county) in(${inList})`,
    $order: "submission_date DESC",
    $limit: String(opts?.limit ?? 500),
  });
  const res = await fetch(`${SODA_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`TABC SODA fetch failed: ${res.status}`);
  const data = (await res.json()) as SodaRecord[];
  return data.map(normalizeTabc).filter(Boolean) as TabcRow[];
}

/** Pipeline notes — dossier-compatible (Owner: sentence). No "Opens" date is
 *  written: the license grant date isn't knowable, and a wrong date is worse
 *  than "soon". The submission date carries the freshness signal. */
export function tabcNotes(t: {
  applicationId: string;
  submittedIso: string | null;
  business: string;
  owner: string | null;
}): string {
  return (
    `TABC license application${t.submittedIso ? ` submitted ${t.submittedIso}` : ""}: ` +
    `${t.business} is opening at this address — alcohol licensing runs 30-90 days ahead of ` +
    `opening day, so the property's vendor decisions are being made now.` +
    (t.owner ? ` Owner: ${t.owner}.` : "")
  );
}

export type TabcRunSummary = {
  scanned: number;
  candidates: number;
  added: number;
  skippedClass: number;
  skippedGrass: number;
  log: string[];
};

export async function runTabcSourcing(opts?: {
  want?: number;
  sinceDays?: number;
  /** Market key (cron ?market=dallas); default the deployment market. */
  market?: string;
}): Promise<TabcRunSummary> {
  const want = opts?.want ?? 8;
  const sinceDays = opts?.sinceDays ?? 120;
  const market = marketByKey(opts?.market);
  const log: string[] = [`Market: ${market.label}`];

  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found. Run `npm run db:seed` first.");

  const rows = await fetchPendingTabc({ counties: market.tabcCounties });
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString().slice(0, 10);
  const candidates = rows.filter((t) => !t.submittedIso || t.submittedIso >= since);
  log.push(`${rows.length} pending applications -> ${candidates.length} submitted in the last ${sinceDays}d`);

  const existing = await db
    .select({
      name: schema.property.name,
      parcelId: sql<string | null>`${schema.property.parcel_geojson}->>'parcel_id'`,
    })
    .from(schema.property);
  const haveName = new Set(existing.map((r) => r.name.trim().toLowerCase()));
  const haveParcel = new Set(existing.map((r) => r.parcelId).filter(Boolean) as string[]);

  const token = getMapboxToken();
  const cfgRow = await getActiveConfig(co.id);
  const rejects = await loadRejects();
  if (!token) log.push("MAPBOX_API not set — cannot geocode; nothing to add");

  let added = 0;
  let skippedClass = 0;
  let skippedGrass = 0;
  let attempts = Math.min(candidates.length, 150);
  for (const t of candidates) {
    if (added >= want || attempts <= 0 || !token) break;
    const business = titleCase(t.owner);
    const name = `${business} (TABC ${t.applicationId})`;
    const rejectKey = `tabc:${t.applicationId}`;
    if (haveName.has(name.trim().toLowerCase())) continue;
    if (rejects.has(rejectKey)) continue; // screened + rejected in a prior run
    attempts--;

    const geo = await geocodeWithZip(`${t.address}, ${t.city}, TX ${t.zip ?? ""}`);
    if (!geo) {
      log.push(`geocode failed: ${business}`);
      continue;
    }

    const hit = await fetchParcelAtPointWithAttrs(geo.lng, geo.lat);
    if (!hit) {
      log.push(`no parcel: ${business}`);
      continue;
    }
    // Gate on the NORMALIZED class so each county's field mapping applies.
    // Bars and restaurants live on F1/F2 — a home address on the application
    // (paperwork mailing address, not the venue) fails this gate. A county
    // with no class data also fails (conservative: never add a house).
    const stateClass = (hit.parcel.state_class ?? "").trim();
    if (!["F1", "F2"].includes(stateClass)) {
      skippedClass++;
      await recordReject(rejectKey, `parcel class ${stateClass || "none"}`);
      continue;
    }
    const parcel = hit.parcel as ParcelResult;
    // Cross-feed dedupe: the sales-tax openings feed often catches the same
    // venue a few weeks later — one parcel, one lead, whichever feed got
    // there first.
    if (parcel.parcel_id && haveParcel.has(parcel.parcel_id)) continue;

    const est = await estimateServiceableArea(parcel, token);
    if (!est) {
      log.push(`imagery failed: ${business}`);
      continue;
    }
    if (!isGrassQualified(est.vegetation_fraction, SIGNAL_MIN_GRASS_FRACTION)) {
      skippedGrass++;
      await recordReject(rejectKey, `grass ${Math.round(est.vegetation_fraction * 100)}%`);
      log.push(
        `skipped (${Math.round(est.vegetation_fraction * 100)}% grass < ${Math.round(SIGNAL_MIN_GRASS_FRACTION * 100)}%): ${business}`
      );
      continue;
    }

    let teaser: Record<string, unknown> | null = null;
    if (cfgRow) {
      try {
        const sz = await sizeLead(parcel, token, toEngineConfig(cfgRow), est);
        teaser = {
          annual_lo: sz.annual_lo,
          annual_hi: sz.annual_hi,
          turf_sqft: sz.turf_sqft,
          projected: sz.projected,
          computed_at: new Date().toISOString().slice(0, 10),
        };
      } catch {
        /* teaser optional */
      }
    }

    await db.insert(schema.property).values({
      company_id: co.id,
      name,
      address: t.address,
      city: t.city,
      zip: t.zip,
      lat: geo.lat,
      lng: geo.lng,
      icp_type: "retail_strip",
      owner_org: null, // suggestion only — operator confirms (spec §9)
      source: "places",
      status: "sourced",
      parcel_geojson: parcel,
      grass_fraction: est.vegetation_fraction,
      lead_teaser: teaser,
      notes: tabcNotes({
        applicationId: t.applicationId,
        submittedIso: t.submittedIso,
        business,
        owner: parcel.owner,
      }),
    });
    haveName.add(name.trim().toLowerCase());
    if (parcel.parcel_id) haveParcel.add(parcel.parcel_id);
    added++;
    log.push(`added ${business} — ${t.address}, ${t.city} (${Math.round(est.vegetation_fraction * 100)}% grass, applied ${t.submittedIso ?? "?"})`);
  }

  return { scanned: rows.length, candidates: candidates.length, added, skippedClass, skippedGrass, log };
}
