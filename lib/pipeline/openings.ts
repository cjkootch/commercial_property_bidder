// New-business-opening lead sourcing (Texas Comptroller sales-tax permit
// feed), shared by the CLI script (scripts/source-openings) and the weekly
// cron (/api/cron/openings): a brand-new sales-tax permit at a commercial
// address means a business is about to open there — the exact moment the
// property's vendor decisions (including grounds) are being made. The
// registration's first-sales date lands in the notes as "Opens YYYY-MM-DD",
// which drives the lead score's timing/urgency signal.
//
// Funnel (each stage is cheap until a candidate earns the next):
//   1. SODA query: recently-issued permits in the corridor ZIPs, newest first.
//   2. NAICS allowlist (physical, grounds-relevant categories) + drop mobile
//      food services and suite/apartment addresses — a food truck or a
//      strip-center suite tenant doesn't buy grounds maintenance.
//   3. Geocode, then the decisive gate: the HCAD parcel must be state_class
//      F1 (real commercial). This structurally rejects home businesses —
//      validated live: residential A1 parcels get cleanly dropped.
//   4. Grass pre-screen + teaser sizing from one shared imagery tile.
//
// Data-source notes (data.texas.gov jrea-zgmq, "Active Sales Tax Permit
// Holders"): a weekly-refreshed snapshot of ACTIVE permits — recency comes
// from outlet_permit_issue_date, not row insertion. Addresses are
// self-reported (stage 3 is what makes them trustworthy). No app token needed
// at this volume.

import { sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { geocodeAddress, getMapboxToken } from "../integrations/geocoding";
import { fetchHarrisParcelAtPoint } from "../integrations/parcel";
import { estimateServiceableArea } from "../integrations/imagery";
import { sizeLead } from "../leads/sizing";
import { getActiveConfig, toEngineConfig } from "../db/queries";
import { isGrassQualified, MIN_GRASS_FRACTION } from "../sourcing/criteria";
import type { ParcelResult } from "../geo/types";

const SODA_URL = "https://data.texas.gov/resource/jrea-zgmq.json";

/** NW-Houston corridor ZIPs (Tomball / Spring / Cypress / NW Houston) —
 *  the ZIP-code equivalent of the pipeline's corridor bbox. */
export const CORRIDOR_ZIPS = [
  "77375", "77377", // Tomball
  "77379", "77388", "77389", "77373", // Spring
  "77429", "77433", // Cypress
  "77070", "77064", "77065", "77066", "77068", "77069", "77090",
  "77086", "77088", "77040", "77041", "77095", "77084", // NW Houston
];

/**
 * NAICS prefixes for businesses that occupy real commercial buildings with
 * grounds: restaurants (7225), auto services (811), dealers/big retail
 * (441/444/445), fitness & recreation (713), storage (531), health &
 * care facilities (621/623/624), personal services (812). Deliberately NOT
 * 454 (online sellers) or 72233 (mobile food) — see keepOpening.
 */
const NAICS_ALLOW = ["7225", "811", "441", "444", "445", "713", "531", "621", "623", "624", "812"];
/** Suite/apartment markers: a unit tenant isn't the grounds decision-maker. */
const UNIT_RE = /\b(APT|STE|SUITE|UNIT|BLDG|RM|TRLR|LOT)\b|#/i;

export type OpeningRow = {
  taxpayer_number?: string;
  outlet_number?: string;
  outlet_name?: string;
  outlet_address?: string;
  outlet_city?: string;
  outlet_zip_code?: string;
  outlet_naics_code?: string;
  outlet_permit_issue_date?: string;
  outlet_first_sales_date?: string;
};

/** Stage-2 filter: physical, grounds-relevant, standalone-address outlets. */
export function keepOpening(r: OpeningRow): boolean {
  const naics = r.outlet_naics_code ?? "";
  if (!NAICS_ALLOW.some((p) => naics.startsWith(p))) return false;
  if (naics.startsWith("72233")) return false; // mobile food services
  if (!r.outlet_name || !r.outlet_address || !r.outlet_permit_issue_date) return false;
  if (UNIT_RE.test(r.outlet_address)) return false;
  return true;
}

/** Map an outlet's NAICS to the closest ICP bucket. */
export function icpFromNaics(naics: string): (typeof schema.icpTypeEnum.enumValues)[number] {
  if (naics.startsWith("621") || naics.startsWith("623")) return "medical";
  if (naics.startsWith("624")) return "daycare";
  if (naics.startsWith("531")) return "self_storage";
  if (naics.startsWith("7225") || naics.startsWith("44") || naics.startsWith("445") || naics.startsWith("812"))
    return "retail_strip";
  if (naics.startsWith("811")) return "industrial";
  return "other";
}

/**
 * Pipeline notes for an opening lead. "Opens YYYY-MM-DD." drives the score's
 * timing/urgency signal (criteria.estimateCompletionFromNotes), and the
 * "Owner: X." sentence matches the dossier's existing owner extraction so the
 * buyer job sheet names the parcel owner — while the registration provenance
 * stays operator-only (buyer artifacts only see regex-extracted fields).
 */
export function openingNotes(o: {
  issueDateIso: string;
  name: string;
  naics: string;
  opensIso: string | null;
  owner: string | null;
}): string {
  return (
    `Sales-tax registration ${o.issueDateIso}: ${o.name} is opening at this address ` +
    `(NAICS ${o.naics}) — the property's vendor decisions are being made now.` +
    (o.opensIso ? ` Opens ${o.opensIso}.` : "") +
    (o.owner ? ` Owner: ${o.owner}.` : "")
  );
}

/** Query the Comptroller feed for recently-issued corridor permits. */
export async function fetchRecentOpenings(opts: {
  sinceDays: number;
  limit: number;
}): Promise<OpeningRow[]> {
  const since = new Date(Date.now() - opts.sinceDays * 86400_000).toISOString().slice(0, 10);
  const zips = CORRIDOR_ZIPS.map((z) => `'${z}'`).join(",");
  const params = new URLSearchParams({
    $where: `outlet_permit_issue_date >= '${since}' AND outlet_zip_code in (${zips})`,
    $select:
      "taxpayer_number,outlet_number,outlet_name,outlet_address,outlet_city," +
      "outlet_zip_code,outlet_naics_code,outlet_permit_issue_date,outlet_first_sales_date",
    $order: "outlet_permit_issue_date DESC",
    $limit: String(opts.limit),
  });
  const res = await fetch(`${SODA_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`Comptroller SODA query failed: ${res.status}`);
  return (await res.json()) as OpeningRow[];
}

export type OpeningRunSummary = {
  scanned: number;
  candidates: number;
  added: number;
  skippedClass: number;
  skippedGrass: number;
  log: string[];
};

export async function runOpeningSourcing(opts?: {
  want?: number;
  sinceDays?: number;
}): Promise<OpeningRunSummary> {
  const want = opts?.want ?? 8;
  const sinceDays = opts?.sinceDays ?? 30;
  const log: string[] = [];

  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found. Run `npm run db:seed` first.");

  // Dedup by name (embeds the permit id) and by parcel id, so an opening on a
  // parcel we already track (from any feed) isn't re-added.
  const existing = await db
    .select({
      name: schema.property.name,
      parcelId: sql<string | null>`${schema.property.parcel_geojson}->>'parcel_id'`,
    })
    .from(schema.property);
  const haveName = new Set(existing.map((r) => r.name.trim().toLowerCase()));
  const haveParcel = new Set(existing.map((r) => r.parcelId).filter(Boolean) as string[]);

  const rows = await fetchRecentOpenings({ sinceDays, limit: 1000 });
  const candidates = rows.filter(keepOpening);
  log.push(
    `${rows.length} new corridor permits -> ${candidates.length} physical standalone candidates (last ${sinceDays}d)`
  );

  const token = getMapboxToken();
  const cfgRow = await getActiveConfig(co.id);
  if (!token) log.push("MAPBOX_API not set — cannot geocode; nothing to add");

  let added = 0;
  let skippedClass = 0;
  let skippedGrass = 0;
  // Geocode + parcel are cheap/free; the imagery tile is the bounded spend.
  let attempts = want * 8;
  for (const r of candidates) {
    if (added >= want || attempts <= 0 || !token) break;
    const name = `${r.outlet_name} (STP ${r.taxpayer_number}-${r.outlet_number})`;
    if (haveName.has(name.trim().toLowerCase())) continue;
    attempts--;

    const address = `${r.outlet_address}, ${r.outlet_city}, TX ${r.outlet_zip_code}`;
    const coords = await geocodeAddress(address);
    if (!coords) {
      log.push(`geocode failed: ${r.outlet_name}`);
      continue;
    }
    const hit = await fetchHarrisParcelAtPoint(coords[0], coords[1]);
    if (!hit) continue;
    const stateClass = String(hit.attrs.state_class ?? "").trim();
    if (stateClass !== "F1") {
      // Home businesses land on residential (A/B) parcels — the decisive gate.
      skippedClass++;
      continue;
    }
    const parcel = hit.parcel as ParcelResult;
    if (parcel.parcel_id && haveParcel.has(parcel.parcel_id)) continue;

    // One tile buys both the grass pre-screen and the teaser sizing.
    const est = await estimateServiceableArea(parcel, token);
    if (!est) {
      log.push(`imagery failed: ${r.outlet_name}`);
      continue;
    }
    if (!isGrassQualified(est.vegetation_fraction)) {
      skippedGrass++;
      log.push(
        `skipped (${Math.round(est.vegetation_fraction * 100)}% grass < ${Math.round(MIN_GRASS_FRACTION * 100)}%): ${r.outlet_name}`
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
      address: r.outlet_address ?? null,
      city: r.outlet_city ?? null,
      zip: r.outlet_zip_code ?? null,
      lat: coords[1],
      lng: coords[0],
      icp_type: icpFromNaics(r.outlet_naics_code ?? ""),
      owner_org: null, // suggestion only — operator confirms (spec §9)
      source: "places",
      status: "sourced",
      parcel_geojson: parcel,
      grass_fraction: est.vegetation_fraction,
      lead_teaser: teaser,
      notes: openingNotes({
        issueDateIso: (r.outlet_permit_issue_date ?? "").slice(0, 10),
        name: r.outlet_name ?? "New business",
        naics: r.outlet_naics_code ?? "?",
        opensIso: r.outlet_first_sales_date ? r.outlet_first_sales_date.slice(0, 10) : null,
        owner: parcel.owner,
      }),
    });
    haveName.add(name.trim().toLowerCase());
    if (parcel.parcel_id) haveParcel.add(parcel.parcel_id);
    added++;
    log.push(
      `added ${r.outlet_name} — ${r.outlet_address}, ${r.outlet_city}` +
        ` (${Math.round(est.vegetation_fraction * 100)}% grass, opens ${r.outlet_first_sales_date?.slice(0, 10) ?? "?"})`
    );
  }

  return {
    scanned: rows.length,
    candidates: candidates.length,
    added,
    skippedClass,
    skippedGrass,
    log,
  };
}
