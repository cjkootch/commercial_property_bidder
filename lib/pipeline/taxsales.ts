// Tax-sale (distressed property) lead sourcing, shared by the CLI
// (scripts/source-taxsales) and the weekly cron (/api/cron/taxsales):
// a property in the county's delinquent-tax-sale pipeline is a forced-action
// signal — pre-auction owners must make the property presentable, and
// post-auction investors re-bid every vendor from scratch. Either way the
// grounds are in play NOW, and distressed parcels are usually overgrown.
//
// Source: taxsales.lgbs.com — the public sale-list API of the law firm that
// runs Harris County's delinquent tax sales (verified live 2026-07-08):
//   GET /api/property_sales/?county=HARRIS COUNTY&state=TX&limit=&offset=
//   - plain JSON, no auth; ~360 Harris properties in the pipeline
//   - each record carries the HCAD account number (account_nbr), the street
//     address, appraised value, GeoJSON point coordinates, sale status
//     ("Scheduled for Auction" | "Available for Future Sale") and, for
//     scheduled ones, the auction date (sale_date_only)
// Coordinates are included, so the parcel gate is a free point lookup —
// this feed spends imagery only on class-qualified parcels.

import { sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { currentMarket } from "../markets";
import { fetchHarrisParcelAtPoint } from "../integrations/parcel";
import { estimateServiceableArea } from "../integrations/imagery";
import { getMapboxToken } from "../integrations/geocoding";
import { sizeLead } from "../leads/sizing";
import { getActiveConfig, toEngineConfig } from "../db/queries";
import { icpGuess } from "./permits";
import { loadRejects, recordReject } from "./rejects";
import { titleCase } from "./transfers";
import type { ParcelResult } from "../geo/types";

const LGBS_URL = "https://taxsales.lgbs.com/api/property_sales/";

export type TaxSaleRow = {
  accountNbr: string;
  address: string;
  city: string | null;
  zip: string | null;
  lat: number;
  lng: number;
  status: string;
  saleDateIso: string | null; // auction date for scheduled sales
  value: number | null; // county-appraised value
  causeNbr: string | null;
};

type LgbsRecord = {
  account_nbr?: string;
  prop_address_one?: string;
  prop_city?: string;
  prop_zipcode?: string;
  status?: string;
  sale_date_only?: string | null;
  value?: string | null;
  cause_nbr?: string | null;
  geometry?: { type: string; coordinates: [number, number] } | null;
};

export function normalizeTaxSale(r: LgbsRecord): TaxSaleRow | null {
  const coords = r.geometry?.coordinates;
  const accountNbr = (r.account_nbr ?? "").trim();
  const address = (r.prop_address_one ?? "").trim();
  if (!accountNbr || !address || !coords || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) {
    return null;
  }
  const value = Number(r.value);
  return {
    accountNbr,
    address: titleCase(address),
    city: r.prop_city ? titleCase(r.prop_city) : null,
    zip: (r.prop_zipcode ?? "").slice(0, 5) || null,
    lng: coords[0],
    lat: coords[1],
    status: (r.status ?? "").trim(),
    saleDateIso: r.sale_date_only ?? null,
    value: Number.isFinite(value) && value > 0 ? value : null,
    causeNbr: r.cause_nbr || null,
  };
}

/** Fetch the Harris County tax-sale pipeline (paged). */
export async function fetchTaxSales(opts?: { limit?: number }): Promise<TaxSaleRow[]> {
  const limit = opts?.limit ?? 400;
  const out: TaxSaleRow[] = [];
  let offset = 0;
  while (out.length < limit) {
    const page = Math.min(200, limit - out.length);
    const params = new URLSearchParams({
      county: currentMarket().taxSaleCounty,
      state: "TX",
      limit: String(page),
      offset: String(offset),
    });
    const res = await fetch(`${LGBS_URL}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`LGBS fetch failed: ${res.status}`);
    const data = (await res.json()) as { results?: LgbsRecord[]; next?: string | null };
    const rows = (data.results ?? []).map(normalizeTaxSale).filter(Boolean) as TaxSaleRow[];
    out.push(...rows);
    if (!data.next || (data.results ?? []).length === 0) break;
    offset += page;
  }
  return out;
}

/** Pipeline notes: forced-action framing, dossier-compatible (Owner: sentence).
 *  "Tax sale scheduled YYYY-MM-DD" is the urgency signal the marketplace
 *  rank reads — only scheduled auctions carry it. */
export function taxSaleNotes(t: {
  accountNbr: string;
  status: string;
  saleDateIso: string | null;
  value: number | null;
  owner: string | null;
}): string {
  const scheduled = t.saleDateIso ? `Tax sale scheduled ${t.saleDateIso}` : `In the tax-sale pipeline (${t.status.toLowerCase()})`;
  return (
    `County tax sale ${t.accountNbr}: ${scheduled} — the property is in the delinquent-tax process` +
    (t.value ? ` (county-appraised at $${Math.round(t.value).toLocaleString("en-US")})` : "") +
    `. Distressed properties are typically under-maintained, owners preparing for or contesting a sale need the grounds presentable, and a post-auction buyer re-bids every vendor.` +
    (t.owner ? ` Owner: ${t.owner}.` : "")
  );
}

export type TaxSaleRunSummary = {
  scanned: number;
  candidates: number;
  added: number;
  skippedClass: number;
  skippedGrass: number;
  log: string[];
};

export async function runTaxSaleSourcing(opts?: {
  want?: number;
  /** Skip parcels the county appraises below this (junk slivers). */
  minValue?: number;
}): Promise<TaxSaleRunSummary> {
  const want = opts?.want ?? 8;
  const minValue = opts?.minValue ?? 100_000;
  const log: string[] = [];

  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found. Run `npm run db:seed` first.");

  const rows = await fetchTaxSales();
  // Scheduled auctions first (they carry a date — the hottest window), then
  // by appraised value so the attempt budget reaches the biggest parcels.
  const candidates = rows
    .filter((t) => (t.value ?? 0) >= minValue)
    .sort((a, b) => {
      if (Boolean(a.saleDateIso) !== Boolean(b.saleDateIso)) return a.saleDateIso ? -1 : 1;
      return (b.value ?? 0) - (a.value ?? 0);
    });
  log.push(`${rows.length} parcels in the tax-sale pipeline -> ${candidates.length} appraised >= $${minValue.toLocaleString("en-US")}`);

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
  if (!token) log.push("MAPBOX_API not set — adding without grass screen or teaser");

  let added = 0;
  let skippedClass = 0;
  let skippedGrass = 0;
  let attempts = Math.min(candidates.length, 200);
  for (const t of candidates) {
    if (added >= want || attempts <= 0) break;
    const name = `${t.address} (TAX ${t.accountNbr})`;
    const rejectKey = `taxsale:${t.accountNbr}`;
    if (haveName.has(name.trim().toLowerCase()) || haveParcel.has(t.accountNbr)) continue;
    if (rejects.has(rejectKey)) continue; // screened + rejected in a prior run
    attempts--;

    const hit = await fetchHarrisParcelAtPoint(t.lng, t.lat);
    if (!hit) {
      log.push(`no parcel: ${t.address}`);
      continue;
    }
    const stateClass = String(hit.attrs.state_class ?? "").trim();
    // Same aperture as the transfer feed: commercial, industrial, apartments,
    // and vacant land big enough to be a mowing contract.
    const acres = Number(hit.attrs.acreage_1) || 0;
    const classOk =
      ["F1", "F2", "B1"].includes(stateClass) ||
      (["C1", "C2"].includes(stateClass) && acres >= 0.5);
    if (!classOk) {
      skippedClass++;
      await recordReject(rejectKey, `parcel class ${stateClass || "none"}`);
      continue;
    }
    const parcel = hit.parcel as ParcelResult;
    if (parcel.parcel_id && haveParcel.has(parcel.parcel_id)) continue;

    // Imagery sizes the teaser only — distressed parcels are the overgrown
    // ones, so a grass gate would throw away exactly the properties whose
    // condition IS the sales pitch. Only bare pavement gets skipped.
    let grassFraction: number | null = null;
    let teaser: Record<string, unknown> | null = null;
    if (token) {
      const est = await estimateServiceableArea(parcel, token);
      if (est) {
        grassFraction = est.vegetation_fraction;
        if (est.vegetation_fraction < 0.05) {
          skippedGrass++;
          await recordReject(rejectKey, `grass ${Math.round(est.vegetation_fraction * 100)}%`);
          log.push(`skipped (bare pavement, ${Math.round(est.vegetation_fraction * 100)}% grass): ${t.address}`);
          continue;
        }
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
      }
    }

    await db.insert(schema.property).values({
      company_id: co.id,
      name,
      address: t.address,
      city: t.city ?? "Houston",
      zip: t.zip,
      lat: t.lat,
      lng: t.lng,
      icp_type: icpGuess(`${parcel.owner ?? ""} ${String(hit.attrs.legal_dscr_2 ?? "")}`),
      owner_org: null, // suggestion only — operator confirms (spec §9)
      source: "places",
      status: "sourced",
      parcel_geojson: parcel,
      grass_fraction: grassFraction,
      lead_teaser: teaser,
      notes: taxSaleNotes({
        accountNbr: t.accountNbr,
        status: t.status,
        saleDateIso: t.saleDateIso,
        value: t.value,
        owner: parcel.owner,
      }),
    });
    haveName.add(name.trim().toLowerCase());
    if (parcel.parcel_id) haveParcel.add(parcel.parcel_id);
    added++;
    log.push(
      `added ${t.address} — ${t.saleDateIso ? `auction ${t.saleDateIso}` : t.status.toLowerCase()}, $${Math.round(t.value ?? 0).toLocaleString("en-US")} appraised (${stateClass})`
    );
  }

  return { scanned: rows.length, candidates: candidates.length, added, skippedClass, skippedGrass, log };
}
