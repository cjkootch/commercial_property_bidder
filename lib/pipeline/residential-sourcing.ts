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

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { titleCase, epochToIso, assembleSiteAddress, geometryCenter } from "./transfers";
import { attomGet, lcKeys } from "../integrations/attom";

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

/** Street-suffix abbreviations both sources use interchangeably. */
const SUFFIX: Record<string, string> = {
  street: "st", drive: "dr", lane: "ln", road: "rd", avenue: "ave", court: "ct",
  circle: "cir", trail: "trl", parkway: "pkwy", boulevard: "blvd", place: "pl",
  terrace: "ter", highway: "hwy", cove: "cv", crossing: "xing",
};

/** Canonical street line: lowercase, punctuation stripped, suffixes folded to
 *  their abbreviation — so "123 Main Street" and "123 MAIN ST" collide. */
export function canonAddr(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^a-z0-9\s#]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SUFFIX[w] ?? w)
    .join(" ");
}

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

export type ResidentialCandidate = {
  /** Which source produced this (also the raw_source dedupe key). */
  sourceKey: "hcad" | "tad" | "attom";
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

// --- ATTOM sale/snapshot: the FRESH deed source -----------------------------
// County GIS layers lag recorded deeds by 3-6 months (verified live: a July
// pull returned December sales, and once ingested the wells run dry). ATTOM
// publishes recordings within ~2-6 weeks — probed live 2026-07-16: 2,216
// Tarrant-area sales recorded in the prior 45 days, freshest 15 days old.
// METERED (trial budget): one call returns up to 100 sales, so a full run is
// ~4-6 calls — the cheapest fresh-mover supply we have. Anchored per metro.

const ATTOM_ANCHORS = [
  { label: "Tarrant", lat: 32.7555, lng: -97.3308, radius: 25 },
  { label: "Harris", lat: 29.7604, lng: -95.3698, radius: 25 },
];
const ATTOM_MAX_PAGES_PER_ANCHOR = 2;

export async function fetchAttomSales(opts: {
  sinceDays: number;
  minValue: number;
  limit: number;
}): Promise<GeoJsonFeature[]> {
  const since = new Date(Date.now() - Math.min(opts.sinceDays, 90) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const out: GeoJsonFeature[] = [];
  for (const a of ATTOM_ANCHORS) {
    for (let page = 1; page <= ATTOM_MAX_PAGES_PER_ANCHOR; page++) {
      if (out.length >= opts.limit) return out;
      const res = await attomGet("/sale/snapshot", {
        latitude: String(a.lat),
        longitude: String(a.lng),
        radius: String(a.radius),
        startsalesearchdate: since,
        endsalesearchdate: today,
        pagesize: "100",
        page: String(page),
      });
      if (!res.ok) {
        // Budget stop or transient failure — take what we have; the county
        // sources still run after us.
        if (!res.budget) console.error(`attom sale/snapshot ${a.label}: ${res.error}`);
        return out;
      }
      if (res.noResult) break;
      const props = ((res.json as { property?: unknown[] })?.property ?? []) as Record<string, unknown>[];
      for (const p of props) out.push({ properties: p });
      if (props.length < 100) break; // last page for this anchor
    }
  }
  return out;
}

/** Normalize one ATTOM sale row (ride-along in feature.properties). */
export function normalizeAttomSale(f: GeoJsonFeature): ResidentialCandidate | null {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const p = lcKeys(f.properties ?? {}) as any;
  const account = str(p.identifier?.attomid) ?? str(p.identifier?.id);
  const address = str(p.address?.line1);
  const city = str(p.address?.locality);
  // ZIP+4 would fragment package grouping into phantom geographies.
  const zipRaw = str(p.address?.postal1);
  const zip = zipRaw?.match(/^\d{5}/)?.[0] ?? null;
  // STRICT date shape: county sources go through epochToIso which guarantees
  // YYYY-MM-DD; ATTOM does not — a datetime here would concat into an
  // Invalid Date at insert and abort the whole sourcing run.
  const saleDateIso = str(p.sale?.saletransdate)?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  const amt = Number(p.sale?.amount?.saleamt);
  const lat = Number(p.location?.latitude);
  const lng = Number(p.location?.longitude);
  const propType = str(p.summary?.proptype);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (!account || !address || !saleDateIso || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // Price band doubles as the single-family screen: no price (commercial/
  // non-disclosure gaps) or outside the volume band -> not this product.
  if (!Number.isFinite(amt) || amt < MIN_HOME_VALUE || amt > MAX_HOME_VALUE) return null;
  if (propType && !/SFR|SINGLE|TOWNHOUSE|RESID/i.test(propType)) return null;
  return {
    sourceKey: "attom",
    account: String(account),
    address: titleCase(address),
    city: city ? titleCase(city) : null,
    zip,
    subdivision: null,
    saleDateIso,
    marketValue: Math.round(amt), // the recorded price IS the value signal
    lotSqft: null,
    yearBuilt: null,
    lat,
    lng,
  };
}

type ResidentialSource = {
  key: "hcad" | "tad" | "attom";
  label: string;
  fetch: (opts: { sinceDays: number; minValue: number; limit: number }) => Promise<GeoJsonFeature[]>;
  normalize: (f: GeoJsonFeature) => ResidentialCandidate | null;
  /** false = a thin window is the truth, don't re-fetch wider (metered
   *  sources: every widening pass costs real API budget). */
  widen?: boolean;
};

const SOURCES: ResidentialSource[] = [
  // Freshest first: ATTOM inserts this month's movers before the county
  // layers backfill last winter's.
  { key: "attom", label: "ATTOM (fresh deeds)", fetch: fetchAttomSales, normalize: normalizeAttomSale, widen: false },
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
      attom: sql<string | null>`${schema.residentialLead.raw_source}->>'attom'`,
      address: schema.residentialLead.address,
      signal_date: schema.residentialLead.signal_date,
    })
    .from(schema.residentialLead);
  const have = new Set<string>();
  // Cross-source guard: ATTOM lands a sale months before the county layer
  // republishes the SAME sale under a different account (often a slightly
  // different recorded date and abbreviation — "St" vs "Street"). Identity
  // that survives the switch: canonicalized street line + sale dates within
  // ~3 months of each other.
  const haveAddr = new Map<string, number[]>();
  const addrDup = (address: string | null, iso: string | null, register: boolean): boolean => {
    if (!address || !iso) return false;
    const key = canonAddr(address);
    const t = new Date(`${iso.slice(0, 10)}T12:00:00Z`).getTime();
    if (!Number.isFinite(t)) return false;
    const dates = haveAddr.get(key) ?? [];
    const dup = dates.some((d) => Math.abs(d - t) < 92 * 86_400_000);
    if (register && !dup) haveAddr.set(key, [...dates, t]);
    return dup;
  };
  for (const r of existing) {
    if (r.hcad) have.add(`hcad:${r.hcad}`);
    if (r.tad) have.add(`tad:${r.tad}`);
    if (r.attom) have.add(`attom:${r.attom}`);
    addrDup(r.address, r.signal_date?.toISOString() ?? null, true);
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
      const windows =
        source.widen === false
          ? [sinceDays]
          : [sinceDays, ...FALLBACK_WINDOWS_DAYS.filter((d) => d > sinceDays)];
      for (const days of windows) {
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
      if (have.has(key) || addrDup(c.address, c.saleDateIso, false)) {
        sourceDupes++;
        continue;
      }
      try {
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
      } catch (e) {
        // One malformed row must not starve every source after it.
        log.push(`  insert failed (${c.address}): ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      have.add(key);
      addrDup(c.address, c.saleDateIso, true);
      sourceAdded++;
    }
    added += sourceAdded;
    duplicates += sourceDupes;
    log.push(`  ${sourceAdded} lead(s) added, ${sourceDupes} already known`);
  }

  // ZIP-month is the package grouping key, and Tarrant's bulk layer
  // publishes no ZIP — heal the gap while we're here (best-effort).
  const zipsFixed = await backfillResidentialZips().catch(() => 0);
  if (zipsFixed) log.push(`ZIP backfill: ${zipsFixed} lead(s) geocoded to a ZIP`);

  return { scanned, added, duplicates, log };
}

/** Backfill missing ZIPs from coordinates via Mapbox reverse geocoding (a
 *  ZIP-less lead can never join a package). Best-effort; returns rows fixed. */
export async function backfillResidentialZips(limit = 150): Promise<number> {
  const token = process.env.MAPBOX_API;
  if (!token) return 0;
  const rows = await db
    .select({ id: schema.residentialLead.id, lat: schema.residentialLead.lat, lng: schema.residentialLead.lng })
    .from(schema.residentialLead)
    .where(and(isNull(schema.residentialLead.zip), isNotNull(schema.residentialLead.lat)))
    .limit(limit);
  let updated = 0;
  for (const r of rows) {
    if (r.lat == null || r.lng == null) continue;
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${r.lng},${r.lat}.json?types=postcode&limit=1&access_token=${token}`
      );
      const json = (await res.json().catch(() => null)) as {
        features?: Array<{ text?: string }>;
      } | null;
      const zip = json?.features?.[0]?.text;
      if (zip && /^\d{5}$/.test(zip)) {
        await db
          .update(schema.residentialLead)
          .set({ zip, updated_at: new Date() })
          .where(eq(schema.residentialLead.id, r.id));
        updated++;
      }
    } catch {
      // best-effort — a geocode hiccup must not fail the sourcing run
    }
  }
  return updated;
}
