// Residential package dossier: the deliverable a buyer pays for. Snapshotted
// onto the unlock row at purchase (same posture as the commercial lead
// dossier) so the report survives later lead edits/archival — what you bought
// is what you keep.

import { eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
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
};

export type ResidentialDossier = {
  generated_at: string;
  lead_count: number;
  leads: ResidentialDossierLead[];
};

export async function buildResidentialDossier(packageId: string): Promise<ResidentialDossier> {
  const rows = await db
    .select({ lead: schema.residentialLead })
    .from(schema.residentialPackageMembership)
    .innerJoin(
      schema.residentialLead,
      eq(schema.residentialPackageMembership.residential_lead_id, schema.residentialLead.id)
    )
    .where(eq(schema.residentialPackageMembership.package_id, packageId));

  const leads = rows
    .map(({ lead }) => ({
      address: lead.address,
      city: lead.city,
      state: lead.state,
      zip: lead.zip,
      subdivision: lead.subdivision_name,
      signal_type: lead.signal_type,
      signal_date: lead.signal_date ? lead.signal_date.toISOString().slice(0, 10) : null,
      estimated_home_value: lead.estimated_home_value,
      lot_size_sqft: lead.lot_size_sqft,
      year_built: lead.year_built,
      confidence: lead.confidence,
      score: calculateLeadScore(lead.signal_type, lead.confidence),
    }))
    .sort(
      (a, b) =>
        b.score - a.score || (b.signal_date ?? "").localeCompare(a.signal_date ?? "")
    );

  return { generated_at: new Date().toISOString(), lead_count: leads.length, leads };
}
