// Orlando (Orange County, FL) commercial-permit lead sourcing — the FL analog
// of the Texas TABS permit feed (lib/pipeline/permits.ts), from the City of
// Orlando's Socrata open-data portal instead of the TDLR registry.
//
// Source: `data.cityoforlando.net` dataset `ryhf-m453` ("Permit Applications"),
// re-probed live 2026-07-12: `estimated_cost` + `plan_review_type`
// (Commercial/Residential) + `worktype` + `permit_address`, ~40-70 commercial
// permits issued/day, current to ~2 days. Each fresh permit becomes a
// `(BLD <permit_number>)` lead — the `BLD` marker resolves to the
// "construction" lead kind and passes the marketplace sellable filter.
//
// Sizing reuses the shared seam: geocode → fetchParcelAtPoint (FL routes to the
// FDOR cadastral) → sizeLead. Nothing Texas-specific here.

import { db } from "../db";
import * as schema from "../db/schema";
import { geocodeAddress } from "../integrations/geocoding";
import { fetchParcelAtPoint } from "../integrations/parcel";
import { sizeLead } from "../leads/sizing";
import { getActiveConfig, toEngineConfig } from "../db/queries";
import { icpGuess } from "./permits";
import type { ParcelResult } from "../geo/types";

const SODA_URL = "https://data.cityoforlando.net/resource/ryhf-m453.json";
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

type PermitRow = {
  permit_number?: string;
  worktype?: string;
  plan_review_type?: string;
  estimated_cost?: string;
  issue_permit_date?: string;
  permit_address?: string;
  property_owner_name?: string;
  project_name?: string;
};

export type OrlandoPermitSummary = {
  scanned: number;
  candidates: number;
  added: number;
  log: string[];
};

export async function runOrlandoPermitSourcing(opts?: {
  want?: number;
  minCost?: number;
  sinceDays?: number;
  /** false = characterize only (geocode/parcel/size) without inserting. */
  apply?: boolean;
}): Promise<OrlandoPermitSummary> {
  const want = opts?.want ?? 8;
  const minCost = opts?.minCost ?? 150_000; // commercial floor (FL runs lower than TX TABS).
  const sinceDays = opts?.sinceDays ?? 45;
  const apply = opts?.apply ?? true;
  const log: string[] = [];

  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found. Run `npm run db:seed` first.");

  const existing = await db.select({ name: schema.property.name }).from(schema.property);
  const have = new Set(existing.map((r) => r.name.trim().toLowerCase()));

  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    $where: `issue_permit_date >= '${since}' AND plan_review_type = 'Commercial' AND estimated_cost > ${minCost}`,
    $select:
      "permit_number,worktype,plan_review_type,estimated_cost,issue_permit_date,permit_address,property_owner_name,project_name",
    $order: "estimated_cost DESC",
    $limit: "200",
  });
  // Orlando's Socrata WAF 403s the default runtime fetch UA (unlike
  // data.texas.gov); send an explicit identifying User-Agent.
  const res = await fetch(`${SODA_URL}?${params.toString()}`, {
    headers: { "User-Agent": "Greenkeep/1.0 (+https://greenkeep.us)" },
  });
  if (!res.ok) {
    log.push(`SODA ${res.status} — skipped`);
    return { scanned: 0, candidates: 0, added: 0, log };
  }
  const rows = (await res.json()) as PermitRow[];
  log.push(`${rows.length} commercial permits ≥ ${usd(minCost)} issued since ${since}`);

  const cfgRow = await getActiveConfig(co.id);
  let added = 0;
  for (const p of rows) {
    if (added >= want) break;
    const cost = Number(p.estimated_cost) || 0;
    const label = (p.project_name || p.permit_address || "Commercial permit").trim();
    if (!p.permit_number) continue;
    const name = `${label} (BLD ${p.permit_number})`;
    if (have.has(name.trim().toLowerCase())) continue;
    if (!p.permit_address) {
      log.push(`no address: ${label}`);
      continue;
    }

    const coords = await geocodeAddress(`${p.permit_address}, Orlando, FL`);
    const parcel = coords ? await fetchParcelAtPoint(coords[0], coords[1]) : null;

    const notes =
      `Orlando permit ${p.permit_number}: ${p.worktype ?? "Commercial"} construction, ` +
      `est. cost ${usd(cost)}.` +
      (p.issue_permit_date ? ` Issued ${p.issue_permit_date.slice(0, 10)}.` : "") +
      (p.property_owner_name?.trim() ? ` Owner: ${p.property_owner_name.trim()}.` : "");

    // Size the marketplace teaser once, so cards show contract value without
    // per-view imagery spend (parity with the TABS feed).
    let teaser: Record<string, unknown> | null = null;
    if (parcel && cfgRow && process.env.MAPBOX_API) {
      try {
        const sz = await sizeLead(parcel as ParcelResult, process.env.MAPBOX_API, toEngineConfig(cfgRow));
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

    if (apply) {
      await db.insert(schema.property).values({
        company_id: co.id,
        name,
        address: p.permit_address,
        city: "Orlando",
        zip: null,
        lat: coords?.[1] ?? null,
        lng: coords?.[0] ?? null,
        icp_type: icpGuess(`${label} ${p.worktype ?? ""}`),
        owner_org: null, // suggestion only — operator confirms (spec §9)
        source: "places",
        status: "sourced",
        parcel_geojson: parcel,
        lead_teaser: teaser,
        notes,
      });
    }
    have.add(name.trim().toLowerCase());
    added++;
    log.push(
      `${apply ? "added" : "would add"} ${usd(cost)} ${label}` +
        `${coords ? "" : " (no geocode)"}${parcel ? "" : " (no parcel)"}${teaser ? "" : " (no teaser)"}`
    );
  }

  return { scanned: rows.length, candidates: rows.length, added, log };
}
