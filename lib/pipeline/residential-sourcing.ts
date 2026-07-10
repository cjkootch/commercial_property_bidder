// Residential lead sourcing: recently-sold single-family homes from the same
// HCAD deed layer the commercial transfer feed reads — the parcels that feed
// deliberately rejects (state_class A1) are exactly this product. A new
// homeowner hires lawn care, pest control, cleaners, and fencing in their
// first weeks; the deed date IS the freshness signal the residential
// economics engine (lib/residential/economics) prices on.
//
// Shared by the weekly cron (/api/cron/residential) and any manual run.
// Volume model, not scarcity: we take every qualifying home (floor on home
// value keeps the addresses worth a vendor's stamp), dedupe on the HCAD
// account carried in raw_source, and land rows as 'sourced' for the package
// builder to bundle by ZIP/subdivision.

import { sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { titleCase, epochToIso, assembleSiteAddress, geometryCenter } from "./transfers";

const HCAD_QUERY_URL =
  "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0/query";

/** Homes below this county market value rarely buy recurring services —
 *  and their addresses drag package quality down. */
export const MIN_HOME_VALUE = 250_000;
/** Deed recency window: past this, the mover has hired everyone already. */
export const SINCE_DAYS = 60;
/** HCAD refreshes new_owner_date with the appraisal roll, so deed dates lag
 *  the layer by months (verified live 2026-07: freshest A1 dates were ~6mo
 *  old). When the ideal window is empty we widen through these fallbacks and
 *  take the NEWEST sales available — the freshness decay in
 *  lib/residential/economics prices the staleness honestly, and signal dates
 *  are printed on the draft for the operator and in the sold report. */
export const FALLBACK_WINDOWS_DAYS = [180, 365];

type GeoJsonFeature = {
  properties?: Record<string, unknown>;
  geometry?: { type: string; coordinates: unknown } | null;
};

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

export type ResidentialCandidate = {
  hcadNum: string;
  address: string;
  city: string | null;
  zip: string | null;
  subdivision: string | null;
  saleDateIso: string;
  marketValue: number | null;
  lotSqft: number | null;
  yearBuilt: number | null;
  lat: number;
  lng: number;
};

/** Normalize one HCAD A1 feature into a residential candidate (null = unusable). */
export function normalizeResidentialSale(f: GeoJsonFeature): ResidentialCandidate | null {
  const p = f.properties ?? {};
  const geometry = f.geometry;
  if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) return null;
  const hcadNum = str(p.HCAD_NUM) || str(p.acct_num);
  const address = assembleSiteAddress(p);
  const saleDateIso = epochToIso(p.new_owner_date);
  const center = geometryCenter(geometry as { type: "Polygon" | "MultiPolygon"; coordinates: unknown });
  if (!hcadNum || !address || !saleDateIso || !center) return null;

  const marketValue = Number(p.total_market_val);
  const acres = Number(p.acreage_1);
  const yearBuilt = Number(p.yr_impr);
  // HCAD splits the legal description across legal_dscr_1..3 (verified live
  // 2026-07): lot/block/tract lines first ("LT 30 BLK 10", "TRS 4B & 5A"),
  // then the subdivision name — which sometimes spans two lines ("FOREST COVE
  // COUNTRY CLUB" + "ESTATES SEC 4"). Keep the non-lot lines, in order.
  const legalLines = [p.legal_dscr_1, p.legal_dscr_2, p.legal_dscr_3]
    .map((v) => str(v))
    .filter(Boolean) as string[];
  const subParts = legalLines.filter((l) => !/^\s*(LTS?|TRS?|RES)\b/i.test(l));
  const subdivision =
    titleCase(
      subParts
        .join(" ")
        .replace(/\s+(R\/P|U\/R)\s*$/i, "") // replat/unrecorded suffix — plat jargon, not a name
        .trim()
    ) || null;

  return {
    hcadNum,
    address,
    city: str(p.site_city) ? titleCase(str(p.site_city)!) : null,
    zip: str(p.site_zip),
    subdivision,
    saleDateIso,
    marketValue: Number.isFinite(marketValue) && marketValue > 0 ? marketValue : null,
    lotSqft: Number.isFinite(acres) && acres > 0 ? Math.round(acres * 43_560) : null,
    yearBuilt: Number.isFinite(yearBuilt) && yearBuilt > 1900 ? yearBuilt : null,
    lat: center[1],
    lng: center[0],
  };
}

/** Query HCAD for recent single-family (A1) sales county-wide. */
export async function fetchRecentResidentialSales(opts: {
  sinceDays: number;
  minValue: number;
  limit: number;
}): Promise<GeoJsonFeature[]> {
  const since = new Date(Date.now() - opts.sinceDays * 86400_000);
  const sinceSql = `${since.toISOString().slice(0, 10)} 00:00:00`;
  const params = new URLSearchParams({
    where:
      `state_class = 'A1' AND new_owner_date >= timestamp '${sinceSql}' ` +
      `AND total_market_val > ${Math.round(opts.minValue)}`,
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    orderByFields: "new_owner_date DESC",
    resultRecordCount: String(opts.limit),
    f: "geojson",
  });
  const res = await fetch(`${HCAD_QUERY_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`HCAD residential query failed: ${res.status}`);
  const data = (await res.json()) as { features?: GeoJsonFeature[]; error?: { message?: string } };
  if (data.error) throw new Error(`HCAD residential query error: ${data.error.message ?? "unknown"}`);
  return data.features ?? [];
}

export type ResidentialSourcingSummary = {
  scanned: number;
  added: number;
  duplicates: number;
  log: string[];
};

/** Pull fresh A1 deed transfers and land them as sourced residential leads.
 *  Dedupe key: the HCAD account (stored in raw_source.hcad). */
export async function runResidentialSourcing(opts?: {
  want?: number;
  minValue?: number;
  sinceDays?: number;
}): Promise<ResidentialSourcingSummary> {
  const want = opts?.want ?? 200;
  const minValue = opts?.minValue ?? MIN_HOME_VALUE;
  const sinceDays = opts?.sinceDays ?? SINCE_DAYS;
  const log: string[] = [];

  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found. Run `npm run db:seed` first.");

  // Newest-first with progressive widening: the county layer's deed dates lag
  // by months, so a fixed short window can be legitimately thin. Keep widening
  // until the window yields enough volume to actually form packages (first
  // live run: 180d had 9 sales — every bundle fell under the 15-address
  // floor), settling for the widest window's haul if none reaches `want`.
  let features: GeoJsonFeature[] = [];
  let windowUsed = sinceDays;
  for (const days of [sinceDays, ...FALLBACK_WINDOWS_DAYS.filter((d) => d > sinceDays)]) {
    features = await fetchRecentResidentialSales({ sinceDays: days, minValue, limit: want * 2 });
    windowUsed = days;
    if (features.length >= want) break;
  }
  const candidates = features
    .map(normalizeResidentialSale)
    .filter(Boolean) as ResidentialCandidate[];
  log.push(
    `${features.length} A1 sales scanned (${windowUsed}d window) -> ${candidates.length} usable` +
      (windowUsed !== sinceDays ? ` — county deed dates lag, widened from ${sinceDays}d` : "")
  );
  if (candidates.length > 0) {
    log.push(`freshest sale: ${candidates[0].saleDateIso}`);
  }

  // Dedupe on the HCAD account stashed in raw_source at insert time.
  const existing = await db
    .select({
      hcad: sql<string | null>`${schema.residentialLead.raw_source}->>'hcad'`,
    })
    .from(schema.residentialLead);
  const have = new Set(existing.map((r) => r.hcad).filter(Boolean) as string[]);

  let added = 0;
  let duplicates = 0;
  for (const c of candidates) {
    if (added >= want) break;
    if (have.has(c.hcadNum)) {
      duplicates++;
      continue;
    }
    await db.insert(schema.residentialLead).values({
      company_id: co.id,
      address: c.address,
      city: c.city,
      state: "TX",
      zip: c.zip,
      lat: c.lat,
      lng: c.lng,
      subdivision_name: c.subdivision,
      signal_type: "recently_sold",
      signal_date: new Date(`${c.saleDateIso}T12:00:00Z`),
      source: "public_deed",
      estimated_home_value: c.marketValue,
      lot_size_sqft: c.lotSqft,
      year_built: c.yearBuilt,
      confidence: "High", // county deed record — the strongest provenance
      status: "sourced",
      notes: `HCAD deed transfer ${c.saleDateIso} (${c.hcadNum})`,
      raw_source: { hcad: c.hcadNum, sale_date: c.saleDateIso },
    });
    have.add(c.hcadNum);
    added++;
  }
  log.push(`${added} residential lead(s) added, ${duplicates} already known`);
  return { scanned: features.length, added, duplicates, log };
}
