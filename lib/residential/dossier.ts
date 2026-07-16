// Residential package dossier: the deliverable a buyer pays for. Snapshotted
// onto the unlock row at purchase (same posture as the commercial lead
// dossier) so the report survives later lead edits/archival — what you bought
// is what you keep.
//
// ATTOM enrichment (2026-07-16): each lead carries the assessor record —
// owner names, what they paid and when, county value, absentee flag. 100%
// hit rate on the DFW cohort, sale PRICES on 85% (in non-disclosure Texas) —
// this is the strong sell. Enriched at publish (operator intent, bounded by
// package size) and again defensively at dossier build; the once-ever cache
// makes the second pass free.

import { eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { ensureResidentialAttom, type AttomFacts } from "../integrations/attom";
import { calculateLeadScore } from "./scoring";

export type ResidentialDossierLead = {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  subdivision: string | null;
  signal_type: string;
  signal_date: string | null; // ISO date
  estimated_home_value: number | null;
  lot_size_sqft: number | null;
  year_built: number | null;
  confidence: string;
  score: number;
  /** ATTOM assessor record (absent on pre-integration snapshots / misses). */
  owner?: string | null;
  purchase_price?: number | null;
  purchase_date?: string | null;
  county_value?: number | null;
  /** true = absentee owner (landlord — a distinct pitch), false = occupant. */
  absentee?: boolean | null;
};

export type ResidentialDossier = {
  generated_at: string;
  lead_count: number;
  leads: ResidentialDossierLead[];
};

async function packageLeads(packageId: string) {
  return db
    .select({ lead: schema.residentialLead })
    .from(schema.residentialPackageMembership)
    .innerJoin(
      schema.residentialLead,
      eq(schema.residentialPackageMembership.residential_lead_id, schema.residentialLead.id)
    )
    .where(eq(schema.residentialPackageMembership.package_id, packageId));
}

/** Enrich every lead in a package through the metered once-ever cache.
 *  Called at publish (bounded spend on operator intent) — build picks up the
 *  cache. Never throws; a budget stop just leaves later leads bare. */
export async function enrichPackageLeads(packageId: string): Promise<number> {
  const rows = await packageLeads(packageId);
  let enriched = 0;
  for (const { lead } of rows) {
    const f = await ensureResidentialAttom(lead).catch(() => null);
    if (f) enriched++;
  }
  return enriched;
}

export async function buildResidentialDossier(packageId: string): Promise<ResidentialDossier> {
  const rows = await packageLeads(packageId);

  // This runs inside the Stripe webhook at purchase (hard response-time
  // budget) — enrichment is sequential under a deadline; past it, cached
  // facts only. Pitch-time enrichment (residential-demand) keeps the cache
  // warm so the deadline almost never bites.
  const deadline = Date.now() + 8_000;
  const leads: ResidentialDossierLead[] = [];
  for (const { lead } of rows) {
    {
      const cached = (lead.attom as AttomFacts | null)?.status === "ok" ? (lead.attom as AttomFacts) : null;
      const f =
        cached ??
        (lead.attom_fetched_at || Date.now() > deadline
          ? null
          : await ensureResidentialAttom(lead).catch(() => null));
      leads.push({
        address: lead.address,
        city: lead.city,
        state: lead.state,
        zip: lead.zip,
        subdivision: lead.subdivision_name,
        signal_type: lead.signal_type,
        signal_date: lead.signal_date ? lead.signal_date.toISOString().slice(0, 10) : null,
        estimated_home_value: lead.estimated_home_value,
        lot_size_sqft: lead.lot_size_sqft,
        year_built: lead.year_built ?? f?.year_built ?? null,
        confidence: lead.confidence,
        score: calculateLeadScore(lead.signal_type, lead.confidence),
        owner: f?.owner ?? null,
        purchase_price: f?.last_sale_price ?? null,
        purchase_date: f?.last_sale_date ?? null,
        county_value: f ? f.market_value ?? f.assessed_value : null,
        absentee: f?.absentee ?? null,
      });
    }
  }

  leads.sort(
    (a, b) => b.score - a.score || (b.signal_date ?? "").localeCompare(a.signal_date ?? "")
  );

  return { generated_at: new Date().toISOString(), lead_count: leads.length, leads };
}
