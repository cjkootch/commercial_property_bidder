// The company graph: one profile per company we've ever pitched, keyed by
// normalized name. Identity refreshes on every campaign; behavioral events
// with no other home (claim-page views, account linkage) land here. Email
// funnel aggregates stay on buyer_outreach and roll up on read.

import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { prospectCompany } from "../db/schema";

/** Normalized company identity key — shared with buyer_outreach.company_key. */
export const companyKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export type CompanyIdentity = {
  name: string;
  trade?: string;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  contact_form_url?: string | null;
  office_city?: string | null;
  office_lat?: number | null;
  office_lng?: number | null;
  commercial_signal?: boolean | null;
};

/** Create-or-refresh a company profile. Never throws — profile writes must
 *  not break a campaign send or a public page render. */
export async function upsertProspectCompany(
  identity: CompanyIdentity,
  event?: { claimView?: boolean; buyerId?: string }
): Promise<void> {
  const key = companyKey(identity.name);
  if (!key) return;
  try {
    const patch = {
      name: identity.name.trim(),
      ...(identity.trade ? { trade: identity.trade } : {}),
      // Newer non-null identity beats stored; nulls never clobber.
      ...(identity.website ? { website: identity.website } : {}),
      ...(identity.email ? { email: identity.email } : {}),
      ...(identity.phone ? { phone: identity.phone } : {}),
      ...(identity.contact_form_url ? { contact_form_url: identity.contact_form_url } : {}),
      ...(identity.office_city ? { office_city: identity.office_city } : {}),
      ...(identity.office_lat != null ? { office_lat: identity.office_lat } : {}),
      ...(identity.office_lng != null ? { office_lng: identity.office_lng } : {}),
      ...(identity.commercial_signal != null ? { commercial_signal: identity.commercial_signal } : {}),
      ...(event?.buyerId ? { buyer_id: event.buyerId } : {}),
      ...(event?.claimView
        ? { claim_views: sql`${prospectCompany.claim_views} + 1`, last_claim_view_at: new Date() }
        : {}),
      updated_at: new Date(),
    };
    await db
      .insert(prospectCompany)
      .values({
        key,
        name: identity.name.trim(),
        trade: identity.trade ?? "landscaping",
        website: identity.website ?? null,
        email: identity.email ?? null,
        phone: identity.phone ?? null,
        contact_form_url: identity.contact_form_url ?? null,
        office_city: identity.office_city ?? null,
        office_lat: identity.office_lat ?? null,
        office_lng: identity.office_lng ?? null,
        commercial_signal: identity.commercial_signal ?? null,
        claim_views: event?.claimView ? 1 : 0,
        last_claim_view_at: event?.claimView ? new Date() : null,
        buyer_id: event?.buyerId ?? null,
      })
      .onConflictDoUpdate({ target: prospectCompany.key, set: patch });
  } catch {
    /* best-effort */
  }
}

/** Record "this company opened a claim page" — the hot unconverted signal. */
export async function recordClaimView(companyName: string | null | undefined): Promise<void> {
  if (!companyName?.trim()) return;
  await upsertProspectCompany({ name: companyName }, { claimView: true });
}

/** Link a profile to the buyer account created from its claim token. */
export async function linkCompanyToBuyer(
  companyName: string | null | undefined,
  buyerId: string
): Promise<void> {
  if (!companyName?.trim()) return;
  await upsertProspectCompany({ name: companyName }, { buyerId });
}

export { prospectCompany, eq };
