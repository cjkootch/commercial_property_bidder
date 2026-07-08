// Ownership-transfer lead sourcing (HCAD deed feed), shared by the CLI script
// (scripts/source-transfers) and the weekly cron (/api/cron/transfers): find
// commercial/industrial parcels ANYWHERE IN HARRIS COUNTY that changed hands
// recently, grass-screen them from imagery, size a marketplace teaser, and
// insert them as sourced properties. A fresh owner is the highest-intent moment for an
// EXISTING building — new owners re-bid their vendors in the first year — and
// the sale date lands in parcel_geojson.last_sale_date, so the lead score's
// "recent owner change" signal lights up with no extra plumbing.
//
// One HCAD query returns everything: site address, owner of record, sale date,
// market value, acreage, owner mailing address, AND the parcel polygon — so
// unlike the TABS pipeline there is no geocoding step and no separate parcel
// lookup. The only per-candidate spend is one imagery tile, shared between the
// grass pre-screen and the teaser sizing.
//
// HCAD ArcGIS quirks (all verified live against the service):
//   - GET only; POST returns 400.
//   - `outFields` must be `*`; naming specific fields returns 400.
//   - No LIKE in `where`; stick to =, >=, AND.
//   - Dates filter as `timestamp 'YYYY-MM-DD HH:MM:SS'` and return epoch ms.
//   - Some numeric-looking attributes are strings (Acreage = "2.2137 AC") —
//     use the numeric twins (acreage_1) instead.
//   - Ownership dates lag recording by months; use a wide window.

import { sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { estimateServiceableArea } from "../integrations/imagery";
import { getMapboxToken } from "../integrations/geocoding";
import { sizeLead } from "../leads/sizing";
import { getActiveConfig, toEngineConfig } from "../db/queries";
import { isGrassQualified, SIGNAL_MIN_GRASS_FRACTION } from "../sourcing/criteria";
import { icpGuess } from "./permits";
import { loadRejects, recordReject } from "./rejects";
import type { ParcelResult } from "../geo/types";

const HCAD_QUERY_URL =
  "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0/query";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

const str = (v: unknown): string => String(v ?? "").trim();

/** "BRETON RIDGE ST" -> "Breton Ridge St" (county records are ALL-CAPS). */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Assemble a street address from HCAD's exploded site_str_* fields. There is
 * no single-field address on this layer (site_addr_1 comes back empty).
 * Returns null when the record has no street name — not worth listing.
 */
export function assembleSiteAddress(attrs: Record<string, unknown>): string | null {
  const name = str(attrs.site_str_name);
  if (!name) return null;
  const num = Number(attrs.site_str_num);
  const parts = [
    Number.isFinite(num) && num > 0 ? String(num) : null,
    str(attrs.site_str_pfx) || null,
    name,
    str(attrs.site_str_sfx) || null,
    str(attrs.site_str_sfx_dir) || null,
  ].filter(Boolean) as string[];
  return titleCase(parts.join(" "));
}

/** Center of a GeoJSON (Multi)Polygon's bounding box -> [lng, lat]. */
export function geometryCenter(geometry: {
  type: string;
  coordinates: unknown;
}): [number, number] | null {
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  const visit = (node: unknown) => {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") {
      minLng = Math.min(minLng, node[0]);
      maxLng = Math.max(maxLng, node[0]);
      minLat = Math.min(minLat, node[1]);
      maxLat = Math.max(maxLat, node[1]);
      return;
    }
    for (const child of node) visit(child);
  };
  visit(geometry?.coordinates);
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null;
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

/** Epoch-millis (HCAD's date encoding) -> "YYYY-MM-DD", or null. */
export function epochToIso(v: unknown): string | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Pipeline notes for a transfer lead. The "Owner: X." sentence matches the
 * dossier's existing owner extraction (lib/leads/dossier.ts) so the buyer job
 * sheet names the owner — while the HCAD provenance itself stays operator-only
 * (buyer artifacts never quote raw notes, only regex-extracted fields, so the
 * sourcing method never reaches a buyer). Deliberately contains no
 * "Est. start/completion" phrasing: an existing building has no construction
 * timeline, so the score's timing signal correctly reports N/A.
 */
export function transferNotes(t: {
  saleDateIso: string;
  owner: string;
  marketValue: number | null;
  acres: number | null;
}): string {
  return (
    `HCAD transfer ${t.saleDateIso}: property changed hands — new owners re-bid ` +
    `their grounds vendors. Owner: ${t.owner}.` +
    (t.marketValue ? ` Market value ${usd(t.marketValue)}.` : "") +
    (t.acres ? ` ${t.acres.toFixed(1)} ac.` : "")
  );
}

export type TransferCandidate = {
  hcadNum: string;
  owner: string;
  address: string;
  city: string | null;
  zip: string | null;
  saleDateIso: string;
  marketValue: number | null;
  acres: number | null;
  center: [number, number];
  /** Owner + legal description + neighborhood, for the ICP-type guess. */
  icpText: string;
  parcel: ParcelResult;
};

type GeoJsonFeature = {
  geometry?: { type: string; coordinates: unknown };
  properties?: Record<string, unknown>;
};

/** Normalize one HCAD feature into a candidate, or null if unusable. */
export function normalizeTransfer(f: GeoJsonFeature): TransferCandidate | null {
  const p = f.properties ?? {};
  const geometry = f.geometry;
  if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) return null;
  const hcadNum = str(p.HCAD_NUM) || str(p.acct_num);
  const owner = str(p.owner_name_1);
  const address = assembleSiteAddress(p);
  const saleDateIso = epochToIso(p.new_owner_date);
  const center = geometryCenter(geometry);
  if (!hcadNum || !owner || !address || !saleDateIso || !center) return null;

  const marketValue = Number(p.total_market_val);
  const acres = Number(p.acreage_1);
  const mailing = [
    [str(p.mail_addr_1), str(p.mail_addr_2)].filter(Boolean).join(" "),
    str(p.mail_city),
    [str(p.mail_state), str(p.mail_zip).replace(/-$/, "")].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  return {
    hcadNum,
    owner,
    address,
    city: str(p.site_city) ? titleCase(str(p.site_city)) : null,
    zip: str(p.site_zip) || null,
    saleDateIso,
    marketValue: Number.isFinite(marketValue) && marketValue > 0 ? marketValue : null,
    acres: Number.isFinite(acres) && acres > 0 ? acres : null,
    center,
    icpText: [owner, str(p.legal_dscr_2), str(p.dscr)].filter(Boolean).join(" "),
    // Same shape fetchParcelAtPoint produces for Harris county — downstream
    // (map boundary, screening, last_sale_date score signal) just works.
    parcel: {
      county: "Harris",
      owner,
      parcel_id: hcadNum,
      address,
      acres: Number.isFinite(acres) && acres > 0 ? acres : null,
      last_sale_date: saleDateIso,
      market_value: Number.isFinite(marketValue) && marketValue > 0 ? marketValue : null,
      owner_mailing_address: mailing || null,
      geometry: geometry as ParcelResult["geometry"],
    },
  };
}

/** Query HCAD for recent commercial (F1) / industrial (F2) transfers,
 *  county-wide — the layer IS Harris County, no geometry filter needed. */
export async function fetchRecentTransfers(opts: {
  sinceMonths: number;
  minMarketValue: number;
  limit: number;
}): Promise<GeoJsonFeature[]> {
  const since = new Date();
  since.setMonth(since.getMonth() - opts.sinceMonths);
  const sinceSql = `${since.toISOString().slice(0, 10)} 00:00:00`;
  const params = new URLSearchParams({
    // F1 commercial, F2 industrial, B1 multifamily (apartment complexes are
    // flagship grounds clients — validated live: 43 of the last 200 $5M+
    // Harris sales were B1), plus C1/C2 vacant land at >=0.5 acre: a freshly
    // bought lot is a pure mowing contract — the volume tier's bread and
    // butter — and unmowed it becomes a 311 citation.
    where:
      `(state_class = 'F1' OR state_class = 'F2' OR state_class = 'B1' ` +
      `OR ((state_class = 'C1' OR state_class = 'C2') AND acreage_1 >= 0.5)) ` +
      `AND new_owner_date >= timestamp '${sinceSql}' ` +
      `AND total_market_val > ${Math.round(opts.minMarketValue)}`,
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    orderByFields: "new_owner_date DESC",
    resultRecordCount: String(opts.limit),
    f: "geojson",
  });
  const res = await fetch(`${HCAD_QUERY_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`HCAD query failed: ${res.status}`);
  const data = (await res.json()) as { features?: GeoJsonFeature[]; error?: { message?: string } };
  if (data.error) throw new Error(`HCAD query error: ${data.error.message ?? "unknown"}`);
  return data.features ?? [];
}

export type TransferRunSummary = {
  scanned: number;
  candidates: number;
  added: number;
  skippedGrass: number;
  log: string[];
};

export async function runTransferSourcing(opts?: {
  want?: number;
  minMarketValue?: number;
  sinceMonths?: number;
}): Promise<TransferRunSummary> {
  const want = opts?.want ?? 8;
  const minMarketValue = opts?.minMarketValue ?? 150_000;
  const sinceMonths = opts?.sinceMonths ?? 12;
  const log: string[] = [];

  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found. Run `npm run db:seed` first.");

  // Dedup against everything already in the book: by name (embeds the HCAD
  // account) and by parcel id, so a TABS lead on the same parcel isn't re-added.
  const existing = await db
    .select({
      name: schema.property.name,
      parcelId: sql<string | null>`${schema.property.parcel_geojson}->>'parcel_id'`,
    })
    .from(schema.property);
  const haveName = new Set(existing.map((r) => r.name.trim().toLowerCase()));
  const haveParcel = new Set(existing.map((r) => r.parcelId).filter(Boolean) as string[]);

  const features = await fetchRecentTransfers({
    sinceMonths,
    minMarketValue,
    limit: Math.min(Math.max(want * 10, 50), 400),
  });
  const candidates = features
    .map(normalizeTransfer)
    .filter(Boolean) as TransferCandidate[];
  log.push(
    `${features.length} recent F1 transfers -> ${candidates.length} usable candidates ` +
      `(last ${sinceMonths}mo, >${usd(minMarketValue)} market value)`
  );

  const token = getMapboxToken();
  const cfgRow = await getActiveConfig(co.id);
  const rejects = await loadRejects();
  if (!token) log.push("MAPBOX_API not set — adding without grass screen or teaser");

  let added = 0;
  let skippedGrass = 0;
  // Each screened candidate costs one imagery tile; bound the spend per run.
  let attempts = want * 6;
  for (const t of candidates) {
    if (added >= want || attempts <= 0) break;
    const name = `${t.address} (HCAD ${t.hcadNum})`;
    const rejectKey = `transfer:${t.hcadNum}`;
    if (haveName.has(name.trim().toLowerCase()) || haveParcel.has(t.hcadNum)) continue;
    if (rejects.has(rejectKey)) continue; // screened + rejected in a prior run
    attempts--;

    // One tile buys both the grass pre-screen and the teaser sizing.
    let grassFraction: number | null = null;
    let teaser: Record<string, unknown> | null = null;
    if (token) {
      const est = await estimateServiceableArea(t.parcel, token);
      if (!est) {
        log.push(`imagery failed: ${t.address}`);
        continue;
      }
      grassFraction = est.vegetation_fraction;
      // Signal feed: the sale is the reason to buy — only screen out
      // bare-pavement parcels (gas stations, pad sites).
      if (!isGrassQualified(grassFraction, SIGNAL_MIN_GRASS_FRACTION)) {
        skippedGrass++;
        await recordReject(rejectKey, `grass ${Math.round(grassFraction * 100)}%`);
        log.push(`skipped (${Math.round(grassFraction * 100)}% grass < ${Math.round(SIGNAL_MIN_GRASS_FRACTION * 100)}%): ${t.address}`);
        continue;
      }
      if (cfgRow) {
        try {
          const sz = await sizeLead(t.parcel, token, toEngineConfig(cfgRow), est);
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
    }

    await db.insert(schema.property).values({
      company_id: co.id,
      name,
      address: t.address,
      city: t.city,
      zip: t.zip,
      lat: t.center[1],
      lng: t.center[0],
      icp_type: icpGuess(t.icpText),
      owner_org: null, // suggestion only — operator confirms (spec §9)
      source: "places",
      status: "sourced",
      parcel_geojson: t.parcel,
      grass_fraction: grassFraction,
      lead_teaser: teaser,
      notes: transferNotes(t),
    });
    haveName.add(name.trim().toLowerCase());
    haveParcel.add(t.hcadNum);
    added++;
    log.push(
      `added ${t.address}${t.city ? `, ${t.city}` : ""} — sold ${t.saleDateIso}` +
        (t.marketValue ? `, ${usd(t.marketValue)}` : "") +
        (grassFraction != null ? `, ${Math.round(grassFraction * 100)}% grass` : "")
    );
  }

  return { scanned: features.length, candidates: candidates.length, added, skippedGrass, log };
}
