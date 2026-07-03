// Lead marketplace packaging: turn measured, priced properties into sellable
// lead records for landscapers in markets we don't serve.
//
// COMPLIANCE RULES (enforced here, not left to the UI):
//   1. PUBLIC-RECORD DATA ONLY. Owner-of-record comes from the county parcel
//      (public record); contacts come from OSM tags / the property's own
//      website. Apollo-enriched contacts are NEVER included — reselling them
//      would violate Apollo's terms.
//   2. INBOUND LEADS ARE NEVER SOLD. People who asked US for a quote gave
//      their info to Greenkeep, not to be resold. Only properties we
//      discovered from public sources ('places') or entered manually qualify.
//   3. SOLD ONCE. Exported leads are stamped (lead_exported_at / lead_buyer)
//      and excluded from future packages, so buyers get exclusivity.
//
// QUALITY TIERS (the buyer sees what they're getting):
//   verified   — a human drew/confirmed the measurement (map_draw or manual)
//   estimated+ — ML measurement that passed the confidence gate (Med)
//   estimated  — RGB/ML measurement, unreviewed (Low confidence)

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { contact, measurement, pricingResult, property, proposal } from "../db/schema";
import type { ParcelResult } from "../geo/types";

/** Funnel states that mean "measured + priced" (sellable work product). */
const SELLABLE_STATUSES = [
  "priced",
  "proposal_ready",
  "outreach_drafted",
  "sent",
  "replied",
] as const;

export type LeadTier = "verified" | "estimated+" | "estimated";

export type LeadRow = {
  property_id: string;
  name: string;
  address: string | null;
  city: string | null;
  zip: string | null;
  county: string | null;
  icp_type: string;
  lot_acres: number | null;
  grass_pct: number | null;
  turf_sqft: number;
  tier: LeadTier;
  monthly_value: number;
  annual_value: number;
  owner_of_record: string | null;
  owner_mailing_address: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  proposal_views: number;
  lat: number | null;
  lng: number | null;
};

function tierFor(source: string, confidence: string): LeadTier {
  if (source === "map_draw" || source === "manual") return "verified";
  if (confidence === "Med" || confidence === "High") return "estimated+";
  return "estimated";
}

/**
 * Build sellable lead rows. scope "unexported" (default) excludes previously
 * sold leads; "all" includes them (for re-generating a past package).
 */
export async function buildLeadRows(scope: "unexported" | "all" = "unexported"): Promise<LeadRow[]> {
  const conds = [
    inArray(property.status, [...SELLABLE_STATUSES]),
    // Rule 2: never sell inbound customer leads.
    inArray(property.source, ["places", "manual"]),
  ];
  if (scope === "unexported") conds.push(isNull(property.lead_exported_at));
  const props = await db.select().from(property).where(and(...conds));
  if (!props.length) return [];
  const ids = props.map((p) => p.id);

  const [meas, prs, cts, pps] = await Promise.all([
    db.select().from(measurement).where(inArray(measurement.property_id, ids)).orderBy(desc(measurement.created_at)),
    db.select().from(pricingResult).where(inArray(pricingResult.property_id, ids)).orderBy(desc(pricingResult.created_at)),
    // Rule 1: only non-Apollo contacts may ship in a lead package.
    db.select().from(contact).where(and(inArray(contact.property_id, ids), eq(contact.source, "manual"))).orderBy(desc(contact.created_at)),
    db.select().from(proposal).where(inArray(proposal.property_id, ids)).orderBy(desc(proposal.created_at)),
  ]);
  const firstBy = <T extends { property_id: string }>(rows: T[]) => {
    const m = new Map<string, T>();
    for (const r of rows) if (!m.has(r.property_id)) m.set(r.property_id, r);
    return m;
  };
  const measBy = firstBy(meas);
  const prBy = firstBy(prs);
  const ctBy = firstBy(cts);
  const ppBy = firstBy(pps);

  const rows: LeadRow[] = [];
  for (const p of props) {
    const m = measBy.get(p.id);
    const pr = prBy.get(p.id);
    if (!m || !pr) continue; // sellable = measured AND priced
    const parcel = (p.parcel_geojson as ParcelResult | null) ?? null;
    const ct = ctBy.get(p.id);
    rows.push({
      property_id: p.id,
      name: p.name,
      address: p.address,
      city: p.city,
      zip: p.zip,
      county: parcel?.county ?? null,
      icp_type: p.icp_type,
      lot_acres: parcel?.acres ?? null,
      grass_pct: p.grass_fraction != null ? Math.round(Number(p.grass_fraction) * 100) : null,
      turf_sqft: m.turf_sqft,
      tier: tierFor(m.source, m.confidence),
      monthly_value: Math.round(pr.monthly_price),
      annual_value: Math.round(pr.annual_price),
      owner_of_record: parcel?.owner ?? p.owner_org ?? null,
      owner_mailing_address: parcel?.owner_mailing_address ?? null,
      contact_name: ct?.full_name ?? null,
      contact_email: ct?.email ?? null,
      contact_phone: ct?.phone ?? null,
      proposal_views: ppBy.get(p.id)?.view_count ?? 0,
      lat: p.lat,
      lng: p.lng,
    });
  }
  // Best leads first: verified > estimated+ > estimated, then by value.
  const rank: Record<LeadTier, number> = { verified: 0, "estimated+": 1, estimated: 2 };
  rows.sort((a, b) => rank[a.tier] - rank[b.tier] || b.annual_value - a.annual_value);
  return rows;
}

const CSV_COLUMNS: (keyof LeadRow)[] = [
  "name", "address", "city", "zip", "county", "icp_type", "lot_acres",
  "grass_pct", "turf_sqft", "tier", "monthly_value", "annual_value",
  "owner_of_record", "owner_mailing_address", "contact_name", "contact_email", "contact_phone",
  "proposal_views", "lat", "lng",
];

export function leadsToCsv(rows: LeadRow[]): string {
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => esc(r[c])).join(","));
  return lines.join("\n") + "\n";
}

/** Stamp exported leads (Rule 3: sold once). */
export async function markLeadsExported(ids: string[], buyer: string | null): Promise<void> {
  if (!ids.length) return;
  await db
    .update(property)
    .set({ lead_exported_at: new Date(), lead_buyer: buyer, updated_at: new Date() })
    .where(and(inArray(property.id, ids), isNull(property.lead_exported_at)));
}
