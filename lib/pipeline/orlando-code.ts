// Orlando (Orange County, FL) code-enforcement lead sourcing — the FL analog of
// the Texas H311 nuisance-violation feed, from the City of Orlando Socrata
// portal. A fresh Open nuisance case (overgrown Lot, green Pool, Tree) is a
// property that needs service NOW — sold as a `(CODE <apno>)` VIOLATION lead.
//
// Source: `data.cityoforlando.net` dataset `k6e8-nw6w` ("Code Enforcement
// Cases"), re-probed live 2026-07-12: `case_type` (Lot/Pool/Tree/…) + free-text
// `case_comments` + `derived_address` + `caseinfostatus`, max casedt current to
// ~1 day. Sizing reuses the shared seam: geocode → fetchParcelAtPoint (FL routes
// to FDOR) → sizeLead. Encode the $where with %20 (encodeURIComponent), not
// URLSearchParams' '+', or Orlando's Akamai WAF 403s it as SQLi.

import { db } from "../db";
import * as schema from "../db/schema";
import { geocodeAddress } from "../integrations/geocoding";
import { fetchParcelAtPoint } from "../integrations/parcel";
import { sizeLead } from "../leads/sizing";
import { getActiveConfig, toEngineConfig } from "../db/queries";
import { icpGuess } from "./permits";
import type { ParcelResult } from "../geo/types";

const SODA_URL = "https://data.cityoforlando.net/resource/k6e8-nw6w.json";
// Nuisance case types that map to a groundskeeping/tree/pool service pitch.
const NUISANCE_TYPES = ["Lot", "Pool", "Tree"];

type CodeRow = {
  apno?: string;
  case_type?: string;
  casedt?: string;
  derived_address?: string;
  case_comments?: string;
  caseinfostatus?: string;
};

export type OrlandoCodeSummary = {
  scanned: number;
  candidates: number;
  added: number;
  log: string[];
};

/** Strip the trailing " ORLANDO FL" so we can tell a real street address from a
 *  blank one ("     ORLANDO FL"); a usable address must carry a house number. */
function hasStreet(addr: string): boolean {
  const street = addr.replace(/\s+ORLANDO\s+FL\s*$/i, "").trim();
  return street.length > 3 && /\d/.test(street);
}

export async function runOrlandoCodeSourcing(opts?: {
  want?: number;
  sinceDays?: number;
  /** false = characterize only (geocode/parcel/size) without inserting. */
  apply?: boolean;
}): Promise<OrlandoCodeSummary> {
  const want = opts?.want ?? 8;
  const sinceDays = opts?.sinceDays ?? 30;
  const apply = opts?.apply ?? true;
  const log: string[] = [];

  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found. Run `npm run db:seed` first.");

  const existing = await db.select({ name: schema.property.name }).from(schema.property);
  const have = new Set(existing.map((r) => r.name.trim().toLowerCase()));

  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString().slice(0, 10);
  const typeList = NUISANCE_TYPES.map((t) => `'${t}'`).join(",");
  const where = `casedt >= '${since}' AND caseinfostatus = 'Open' AND case_type in(${typeList})`;
  const select = "apno,case_type,casedt,derived_address,case_comments,caseinfostatus";
  // %20 encoding (see file header) — NOT URLSearchParams' '+'.
  const q =
    `$where=${encodeURIComponent(where)}` +
    `&$select=${encodeURIComponent(select)}` +
    `&$order=${encodeURIComponent("casedt DESC")}` +
    `&$limit=300`;
  const res = await fetch(`${SODA_URL}?${q}`, {
    headers: { "User-Agent": "Greenkeep/1.0 (+https://greenkeep.us)" },
  });
  if (!res.ok) {
    log.push(`SODA ${res.status} — skipped`);
    return { scanned: 0, candidates: 0, added: 0, log };
  }
  const rows = (await res.json()) as CodeRow[];
  const candidates = rows.filter((r) => r.apno && r.derived_address && hasStreet(r.derived_address));
  log.push(`${rows.length} open nuisance cases since ${since} → ${candidates.length} with a street address`);

  const cfgRow = await getActiveConfig(co.id);
  let added = 0;
  for (const p of candidates) {
    if (added >= want) break;
    const addr = p.derived_address!.replace(/\s+/g, " ").trim();
    const label = addr.replace(/\s+ORLANDO\s+FL\s*$/i, "").trim();
    const name = `${label} (CODE ${p.apno})`;
    if (have.has(name.trim().toLowerCase())) continue;

    const coords = await geocodeAddress(addr.endsWith("FL") ? addr : `${addr}, Orlando, FL`);
    const parcel = coords ? await fetchParcelAtPoint(coords[0], coords[1]) : null;

    const comment = p.case_comments?.trim().replace(/\s+/g, " ").slice(0, 200);
    const notes =
      `Orlando code case ${p.apno}: ${p.case_type} nuisance violation (Open).` +
      (p.casedt ? ` Opened ${p.casedt.slice(0, 10)}.` : "") +
      (comment ? ` "${comment}"` : "") +
      (parcel?.owner ? ` Owner: ${parcel.owner}.` : "");

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
        address: label || addr,
        city: "Orlando",
        zip: null,
        lat: coords?.[1] ?? null,
        lng: coords?.[0] ?? null,
        icp_type: icpGuess(`${parcel?.owner ?? ""} ${p.case_type ?? ""} ${comment ?? ""}`),
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
      `${apply ? "added" : "would add"} ${p.case_type} ${label}` +
        `${coords ? "" : " (no geocode)"}${parcel ? "" : " (no parcel)"}${teaser ? "" : " (no teaser)"}`
    );
  }

  return { scanned: rows.length, candidates: candidates.length, added, log };
}
