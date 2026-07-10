// Residential lead sourcing: recently-sold single-family homes from county
// appraisal-district layers — the parcels the commercial feeds deliberately
// reject are exactly this product. A new homeowner hires lawn care, pest
// control, cleaners, and fencing in their first weeks; the deed date IS the
// freshness signal the residential economics engine prices on.
//
// Two live sources (one per county, each with its own quirks — verified live):
//   - Harris (HCAD): state_class A1 filter, legal_dscr_1..3 subdivision lines,
//     epoch-ms new_owner_date. Deed dates lag ~3-6 months (appraisal roll).
//   - Tarrant (TAD, Dynamic/TADParcels): BEDROOMS is zeroed on the bulk layer,
//     so single-family = a LIVING_ARE band + a value ceiling; native
//     SubdivisionName column; sentinel deed dates in year 8201 require an
//     upper bound. Freshest deeds ~3 months old.
// Dallas County's GIS publishes no deed date — blocked on the DCAD bulk
// export (research in flight).
//
// Volume model, not scarcity: take every qualifying home (value floor keeps
// the addresses worth a vendor's stamp), dedupe on the county account carried
// in raw_source, land rows as 'sourced' for the package builder.

import { sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { titleCase, epochToIso, assembleSiteAddress, geometryCenter } from "./transfers";

const HCAD_QUERY_URL =
  "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0/query";
const TAD_QUERY_URL =
  "https://mapit.tarrantcounty.com/arcgis/rest/services/Dynamic/TADParcels/MapServer/0/query";

/** Homes below this county market value rarely buy recurring services —
 *  and their addresses drag package quality down. */
export const MIN_HOME_VALUE = 250_000;
/** Above this, it's estates/commercial mixed in — not the volume product. */
export const MAX_HOME_VALUE = 1_500_000;
/** Deed recency window: past this, the mover has hired everyone already. */
export const SINCE_DAYS = 60;
/** County deed dates lag the layers by months (verified live 2026-07). When
 *  the ideal window is thin we widen through these fallbacks and take the
 *  NEWEST sales available — the freshness decay in
 *  lib/residential/economics prices the staleness honestly, and signal dates
 *  are printed on the draft for the operator and in the sold report. */
export const FALLBACK_WINDOWS_DAYS = [180, 365];
/** Tarrant's bulk layer zeroes BEDROOMS — single-family = this living-area
 *  band (cuts hospitals/industrial that carry LIVING_ARE too). */
export const TARRANT_LIVING_SQFT = [800, 6000] as const;

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
  /** Which county source produced this (also the raw_source dedupe key). */
  sourceKey: "hcad" | "tad";
  /** County account number — the dedupe identity. */
  account: string;
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
  const account = str(p.HCAD_NUM) || str(p.acct_num);
  const address = assembleSiteAddress(p);
  const saleDateIso = epochToIso(p.new_owner_date);
  const center = geometryCenter(geometry as { type: "Polygon" | "MultiPolygon"; coordinates: unknown });
  if (!account || !address || !saleDateIso || !center) return null;

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
    sourceKey: "hcad",
    account,
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

/** Normalize one Tarrant TADParcels feature (null = unusable). */
export function normalizeTarrantSale(f: GeoJsonFeature): ResidentialCandidate | null {
  const p = f.properties ?? {};
  const geometry = f.geometry;
  if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) return null;
  const account = str(p.ACCOUNT) || str(p.TAXPIN);
  const address = str(p.SITUS_ADDR) ? titleCase(str(p.SITUS_ADDR)!) : null;
  const saleDateIso = epochToIso(p.DEED_DATE);
  const center = geometryCenter(geometry as { type: "Polygon" | "MultiPolygon"; coordinates: unknown });
  if (!account || !address || !saleDateIso || !center) return null;
  // Sentinel deed dates exist (year 8201) — the query bounds them, but a
  // normalizer must not trust its caller.
  if (saleDateIso.slice(0, 4) > String(new Date().getFullYear() + 1)) return null;

  const marketValue = Number(p.TOTAL_VALU);
  const lotSqft = Number(p.LAND_SQFT);
  const yearBuilt = Number(p.YEAR_BUILT);
  // "TARRANT COUNTY" rides in CITY for unincorporated parcels — not a city.
  const rawCity = str(p.CITY);
  const city = rawCity && !/^tarrant county$/i.test(rawCity) ? titleCase(rawCity) : null;

  return {
    sourceKey: "tad",
    account,
    address,
    city,
    zip: str(p.ZIPCODE),
    subdivision: str(p.SubdivisionName) ? titleCase(str(p.SubdivisionName)!) : null,
    saleDateIso,
    marketValue: Number.isFinite(marketValue) && marketValue > 0 ? marketValue : null,
    lotSqft: Number.isFinite(lotSqft) && lotSqft > 0 ? Math.round(lotSqft) : null,
    yearBuilt: Number.isFinite(yearBuilt) && yearBuilt > 1900 ? yearBuilt : null,
    lat: center[1],
    lng: center[0],
  };
}

async function queryArcGisGeoJson(
  url: string,
  params: Record<string, string>
): Promise<GeoJsonFeature[]> {
  const sp = new URLSearchParams({
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
    ...params,
  });
  const res = await fetch(`${url}?${sp.toString()}`);
  if (!res.ok) throw new Error(`residential query failed: ${res.status} (${url})`);
  const data = (await res.json()) as { features?: GeoJsonFeature[]; error?: { message?: string } };
  if (data.error) throw new Error(`residential query error: ${data.error.message ?? "unknown"} (${url})`);
  return data.features ?? [];
}

/** Query HCAD for recent single-family (A1) sales county-wide. */
export async function fetchRecentResidentialSales(opts: {
  sinceDays: number;
  minValue: number;
  limit: number;
}): Promise<GeoJsonFeature[]> {
  const since = new Date(Date.now() - opts.sinceDays * 86400_000);
  const sinceSql = `${since.toISOString().slice(0, 10)} 00:00:00`;
  return queryArcGisGeoJson(HCAD_QUERY_URL, {
    where:
      `state_class = 'A1' AND new_owner_date >= timestamp '${sinceSql}' ` +
      `AND total_market_val > ${Math.round(opts.minValue)}`,
    orderByFields: "new_owner_date DESC",
    resultRecordCount: String(opts.limit),
  });
}

/** Query Tarrant TADParcels for recent single-family sales county-wide. */
export async function fetchRecentTarrantSales(opts: {
  sinceDays: number;
  minValue: number;
  limit: number;
}): Promise<GeoJsonFeature[]> {
  const since = new Date(Date.now() - opts.sinceDays * 86400_000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  const [minLiv, maxLiv] = TARRANT_LIVING_SQFT;
  return queryArcGisGeoJson(TAD_QUERY_URL, {
    where:
      `LIVING_ARE >= ${minLiv} AND LIVING_ARE <= ${maxLiv} ` +
      `AND TOTAL_VALU > ${Math.round(opts.minValue)} AND TOTAL_VALU < ${MAX_HOME_VALUE} ` +
      `AND DEED_DATE >= DATE '${since}' AND DEED_DATE <= DATE '${tomorrow}'`,
    orderByFields: "DEED_DATE DESC",
    resultRecordCount: String(opts.limit),
  });
}

type ResidentialSource = {
  key: "hcad" | "tad";
  label: string;
  fetch: (opts: { sinceDays: number; minValue: number; limit: number }) => Promise<GeoJsonFeature[]>;
  normalize: (f: GeoJsonFeature) => ResidentialCandidate | null;
};

const SOURCES: ResidentialSource[] = [
  { key: "hcad", label: "Harris (HCAD)", fetch: fetchRecentResidentialSales, normalize: normalizeResidentialSale },
  { key: "tad", label: "Tarrant (TAD)", fetch: fetchRecentTarrantSales, normalize: normalizeTarrantSale },
];

export type ResidentialSourcingSummary = {
  scanned: number;
  added: number;
  duplicates: number;
  log: string[];
};

/** Pull fresh single-family deed transfers from every county source and land
 *  them as sourced residential leads. Dedupe key: the county account stored
 *  in raw_source under the source key ("hcad" / "tad"). `want` caps inserts
 *  PER SOURCE. A failing county logs and is skipped — one county's outage
 *  must not starve the others. */
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

  // Dedupe on the county account stashed in raw_source at insert time.
  const existing = await db
    .select({
      hcad: sql<string | null>`${schema.residentialLead.raw_source}->>'hcad'`,
      tad: sql<string | null>`${schema.residentialLead.raw_source}->>'tad'`,
    })
    .from(schema.residentialLead);
  const have = new Set<string>();
  for (const r of existing) {
    if (r.hcad) have.add(`hcad:${r.hcad}`);
    if (r.tad) have.add(`tad:${r.tad}`);
  }

  let scanned = 0;
  let added = 0;
  let duplicates = 0;

  for (const source of SOURCES) {
    let features: GeoJsonFeature[] = [];
    let windowUsed = sinceDays;
    try {
      // Newest-first with progressive widening: county deed dates lag by
      // months, so a fixed short window can be legitimately thin. Keep
      // widening until a window yields at least `want` sales, settling for
      // the widest window's haul otherwise.
      for (const days of [sinceDays, ...FALLBACK_WINDOWS_DAYS.filter((d) => d > sinceDays)]) {
        features = await source.fetch({ sinceDays: days, minValue, limit: want * 2 });
        windowUsed = days;
        if (features.length >= want) break;
      }
    } catch (e) {
      log.push(`${source.label}: FAILED — ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const candidates = features
      .map(source.normalize)
      .filter(Boolean) as ResidentialCandidate[];
    scanned += features.length;
    log.push(
      `${source.label}: ${features.length} sales scanned (${windowUsed}d window) -> ${candidates.length} usable` +
        (windowUsed !== sinceDays ? ` — deed dates lag, widened from ${sinceDays}d` : "")
    );
    if (candidates.length > 0) log.push(`  freshest sale: ${candidates[0].saleDateIso}`);

    let sourceAdded = 0;
    let sourceDupes = 0;
    for (const c of candidates) {
      if (sourceAdded >= want) break;
      const key = `${c.sourceKey}:${c.account}`;
      if (have.has(key)) {
        sourceDupes++;
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
        notes: `${source.label} deed transfer ${c.saleDateIso} (${c.account})`,
        raw_source: { [c.sourceKey]: c.account, sale_date: c.saleDateIso },
      });
      have.add(key);
      sourceAdded++;
    }
    added += sourceAdded;
    duplicates += sourceDupes;
    log.push(`  ${sourceAdded} lead(s) added, ${sourceDupes} already known`);
  }

  return { scanned, added, duplicates, log };
}
