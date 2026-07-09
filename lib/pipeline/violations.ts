// Code-violation lead sourcing (Houston 311 nightly extract), shared by the
// CLI (scripts/source-violations) and the weekly cron (/api/cron/violations):
// a property CITED for weeds/overgrowth is an owner who must arrange grounds
// service NOW — the most urgent buying signal of any feed, and the easiest
// sell on the shelf ("the city already told them to hire you").
//
// Source: Houston 311's public month-to-date extract — a nightly pipe-
// delimited text file (https://hfdapp.houstontx.gov/311/...D365-MTD-...txt).
// No API, but the file carries everything: case type, address, LAT/LNG (no
// geocoding needed), status, created date. Most weed complaints are
// residential; the HCAD commercial-parcel gate (F1/F2/B1) does the filtering,
// same as the openings feed. No grass gate — a property cited for overgrowth
// has grass by definition; imagery only sizes the teaser.

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
import type { ParcelResult } from "../geo/types";

// Houston-format 311 extract only — a market without one skips this feed.
const EXTRACT_URL = currentMarket().violations311Url ?? null;

/** 311 case types that mean "the grounds are the problem". Values verified
 *  against the live extract (2026-07): dumping (~154/mo) and heavy-trash
 *  violations (~131/mo) are property-cleanup citations — the same must-act
 *  posture as weeds, sold as a cleanup visit that opens the grounds contract.
 *  Drainage / tree-trim types stay OUT: those are mostly city right-of-way. */
const CASE_TYPES = new Set([
  "Weeds/Trash/Stagnant Water on Property",
  "Nuisance On Property",
  "Trash Dumping or Illegal Dumpsite",
  "Heavy Trash Code Violation",
]);

/** Case types whose citation is about debris/dumping rather than overgrowth. */
const CLEANUP_TYPES = new Set(["Trash Dumping or Illegal Dumpsite", "Heavy Trash Code Violation"]);

export type ViolationRow = {
  caseNumber: string;
  address: string;
  lat: number;
  lng: number;
  status: string;
  createdIso: string; // YYYY-MM-DD
  caseType: string;
  zip: string | null;
  city: string | null;
};

/** Parse the pipe-delimited nightly extract into grounds-violation rows. */
export function parseExtract(text: string): ViolationRow[] {
  const lines = text.split("\n");
  const headerIdx = lines.findIndex((l) => l.includes("Case Number|") && l.includes("|Latitude|"));
  if (headerIdx === -1) return [];
  const cols = lines[headerIdx].split("|").map((c) => c.trim());
  const col = (name: string) => cols.indexOf(name);
  const iCase = col("Case Number");
  const iAddr = col("Incident Address");
  const iLat = col("Latitude");
  const iLng = col("Longitude");
  const iStatus = col("Status");
  const iCreated = col("Created Date Local");
  const iType = col("Incident Case Type");
  const iZip = col("Zip Code");
  const iCity = col("Incident City");
  if ([iCase, iAddr, iLat, iLng, iType].some((i) => i === -1)) return [];

  const out: ViolationRow[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const f = line.split("|");
    if (f.length < cols.length - 5) continue;
    const caseType = (f[iType] ?? "").trim();
    if (!CASE_TYPES.has(caseType)) continue;
    const lat = Number(f[iLat]);
    const lng = Number(f[iLng]);
    const address = (f[iAddr] ?? "").trim();
    const caseNumber = (f[iCase] ?? "").trim();
    if (!caseNumber || !address || !Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0) continue;
    // A stray pipe in a mid-row free-text field shifts trailing columns —
    // validate the zip shape so shifted rows store null instead of garbage.
    const zipRaw = (f[iZip] ?? "").trim();
    out.push({
      caseNumber,
      address,
      lat,
      lng,
      status: (f[iStatus] ?? "").trim(),
      createdIso: (f[iCreated] ?? "").trim().slice(0, 10),
      caseType,
      zip: /^\d{5}/.test(zipRaw) ? zipRaw.slice(0, 5) : null,
      city: iCity !== -1 ? (f[iCity] ?? "").trim() || null : null,
    });
  }
  return out;
}

/** Pipeline notes: urgent, honest, dossier-compatible (Owner: sentence).
 *  The wording tracks the citation type — a dumping citation is a cleanup
 *  sell, an overgrowth citation is a mowing sell. */
export function violationNotes(v: {
  caseNumber: string;
  createdIso: string;
  owner: string | null;
  caseType?: string;
}): string {
  const cleanup = v.caseType != null && CLEANUP_TYPES.has(v.caseType);
  const cited = cleanup
    ? `the property was cited for illegal dumping/debris — the owner is required to arrange ` +
      `cleanup now, and the cleanup visit is the natural opening for the grounds contract.`
    : `the property was cited for weeds/overgrowth — the owner is required to arrange ` +
      `grounds service now, and a citation usually means there's no vendor on the property at all.`;
  return (
    `311 case ${v.caseNumber} (${v.createdIso}): ${cited}` + (v.owner ? ` Owner: ${v.owner}.` : "")
  );
}

export type ViolationRunSummary = {
  scanned: number;
  candidates: number;
  added: number;
  skippedClass: number;
  log: string[];
};

export async function runViolationSourcing(opts?: {
  want?: number;
  sinceDays?: number;
}): Promise<ViolationRunSummary> {
  const want = opts?.want ?? 8;
  const sinceDays = opts?.sinceDays ?? 14;
  const log: string[] = [];

  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found. Run `npm run db:seed` first.");

  if (!EXTRACT_URL) throw new Error("No 311 extract URL for this market");
  const res = await fetch(EXTRACT_URL);
  if (!res.ok) throw new Error(`311 extract fetch failed: ${res.status}`);
  const rows = parseExtract(await res.text());
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString().slice(0, 10);
  const candidates = rows
    .filter((v) => v.createdIso >= since && !/closed|cancel/i.test(v.status))
    .sort((a, b) => (a.createdIso < b.createdIso ? 1 : -1));
  // The source file is MONTH-TO-DATE: early-month runs cannot see the tail of
  // the previous month. Say so, loudly, so a thin run isn't misread.
  if (new Date().getUTCDate() < sinceDays) {
    log.push(
      `note: extract is month-to-date — citations from the last ${sinceDays - new Date().getUTCDate()} day(s) of the previous month are not in this file`
    );
  }
  log.push(`${rows.length} grounds-violation cases MTD -> ${candidates.length} open in the last ${sinceDays}d`);

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

  let added = 0;
  let skippedClass = 0;
  // Most citations are residential; parcel lookups are free, so allow a deep
  // scan — the imagery spend only happens after the class gate.
  let attempts = Math.min(candidates.length, 400);
  for (const v of candidates) {
    if (added >= want || attempts <= 0) break;
    // Strip "<CITY> TX <zip>" using the extract's own city column (addresses
    // aren't all Houston: Kingwood, Katy annexations, zip+4 forms).
    const stripped = v.city
      ? v.address.replace(new RegExp(` ${v.city} TX \\d{5}(-\\d{4})?$`, "i"), "")
      : v.address.replace(/ HOUSTON TX \d{5}(-\d{4})?$/i, "");
    const name = `${stripped} (H311 ${v.caseNumber})`;
    const rejectKey = `violation:${v.caseNumber}`;
    if (haveName.has(name.trim().toLowerCase())) continue;
    if (rejects.has(rejectKey)) continue; // screened + rejected in a prior run
    attempts--;

    const hit = await fetchHarrisParcelAtPoint(v.lng, v.lat);
    if (!hit) {
      log.push(`no parcel: ${v.address}`);
      continue;
    }
    const stateClass = String(hit.attrs.state_class ?? "").trim();
    if (!["F1", "F2", "B1"].includes(stateClass)) {
      skippedClass++;
      await recordReject(rejectKey, `parcel class ${stateClass || "none"}`);
      continue;
    }
    const parcel = hit.parcel as ParcelResult;
    if (parcel.parcel_id && haveParcel.has(parcel.parcel_id)) continue;

    // Imagery sizes the teaser only — a cited property has grass by definition.
    let grassFraction: number | null = null;
    let teaser: Record<string, unknown> | null = null;
    if (token) {
      const est = await estimateServiceableArea(parcel, token);
      if (est) {
        grassFraction = est.vegetation_fraction;
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
      address: stripped,
      city: v.city ? v.city.charAt(0) + v.city.slice(1).toLowerCase() : "Houston",
      zip: v.zip,
      lat: v.lat,
      lng: v.lng,
      icp_type: icpGuess(`${parcel.owner ?? ""} ${String(hit.attrs.legal_dscr_2 ?? "")}`),
      owner_org: null, // suggestion only — operator confirms (spec §9)
      source: "places",
      status: "sourced",
      parcel_geojson: parcel,
      grass_fraction: grassFraction,
      lead_teaser: teaser,
      notes: violationNotes({ caseNumber: v.caseNumber, createdIso: v.createdIso, owner: parcel.owner, caseType: v.caseType }),
    });
    haveName.add(name.trim().toLowerCase());
    if (parcel.parcel_id) haveParcel.add(parcel.parcel_id);
    added++;
    log.push(`added ${v.address} — cited ${v.createdIso} (${stateClass})`);
  }

  return { scanned: rows.length, candidates: candidates.length, added, skippedClass, log };
}
