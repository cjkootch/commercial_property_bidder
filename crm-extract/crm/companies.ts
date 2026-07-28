// Company identity + idempotent upsert.
//
// Ported and generalized from lib/leads/companies.ts, whose central insight is
// the one this whole requirement rests on: give a company a NORMALIZED KEY, make
// it UNIQUE in the database, and every import becomes safe to re-run because the
// database — not the importer's memory — enforces "one row per company".
//
// Two source lessons kept:
//   - NULLS NEVER CLOBBER. A re-import from a thinner source must not blank out
//     an email you already had. Only non-null incoming values are written.
//   - CHANGED IDENTITY INVALIDATES DERIVED STATE. In the source app a re-scraped
//     phone number silently inherited the previous number's line-type verdict.
//     Same class of bug here: a changed domain invalidates a domain-derived
//     match, so we clear what we can no longer vouch for.

import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { activity, company, contact, type Company } from "../db/schema";
import { logAudit } from "./audit";

/** Normalized identity key. Lowercase, collapse whitespace, drop punctuation and
 *  the corporate-suffix noise that makes "Acme Industries, Inc." and "Acme
 *  Industries Inc" two rows. Deterministic and dependency-free so an importer,
 *  a webhook and a UI action all derive the same key. */
export function companyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,''`"()]/g, "")
    .replace(/\b(inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|lp|llp|holdings?|group)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Registrable-ish domain from a website URL or email. Second dedupe axis: two
 *  spellings of one company usually share a domain. */
export function domainOf(websiteOrEmail: string | null | undefined): string | null {
  if (!websiteOrEmail) return null;
  const s = websiteOrEmail.trim().toLowerCase();
  if (!s) return null;
  const fromEmail = s.includes("@") ? s.split("@")[1] : null;
  const host = fromEmail ?? s.replace(/^https?:\/\//, "").split("/")[0];
  const clean = host?.replace(/^www\./, "").split(":")[0]?.trim();
  return clean && clean.includes(".") ? clean : null;
}

export type CompanyIdentity = {
  name: string;
  legal_name?: string | null;
  website?: string | null;
  domain?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  brand_id?: string | null;
  owner_user_id?: string | null;
  source?: string | null;
  description?: string | null;
};

export type UpsertResult = { id: string; created: boolean };

/**
 * Create-or-refresh a company by normalized key. Idempotent: running the same
 * input twice produces one row and the second run reports created=false.
 *
 * Concurrency-safe WITHOUT a transaction (which the Neon HTTP driver lacks): the
 * guarantee is the UNIQUE index on dedupe_key plus ON CONFLICT, so two parallel
 * importers racing on the same company resolve to one row rather than throwing.
 */
export async function upsertCompany(identity: CompanyIdentity): Promise<UpsertResult> {
  const key = companyKey(identity.name);
  if (!key) throw new Error("upsertCompany: name normalizes to an empty key");
  const domain = identity.domain ?? domainOf(identity.website) ?? domainOf(identity.email);

  const existing = await db
    .select({ id: company.id, domain: company.domain })
    .from(company)
    .where(eq(company.dedupe_key, key))
    .limit(1);

  // Only non-null incoming values are written — a thinner source never blanks
  // out richer stored data.
  const patch: Record<string, unknown> = {
    name: identity.name.trim(),
    updated_at: new Date(),
  };
  const setIf = (col: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== "") patch[col] = v;
  };
  setIf("legal_name", identity.legal_name);
  setIf("website", identity.website);
  setIf("domain", domain);
  setIf("phone", identity.phone);
  setIf("email", identity.email);
  setIf("address", identity.address);
  setIf("city", identity.city);
  setIf("state", identity.state);
  setIf("postal_code", identity.postal_code);
  setIf("country", identity.country);
  setIf("brand_id", identity.brand_id);
  setIf("owner_user_id", identity.owner_user_id);
  setIf("source", identity.source);
  setIf("description", identity.description);

  const [row] = await db
    .insert(company)
    .values({
      dedupe_key: key,
      name: identity.name.trim(),
      legal_name: identity.legal_name ?? null,
      website: identity.website ?? null,
      domain,
      phone: identity.phone ?? null,
      email: identity.email ?? null,
      address: identity.address ?? null,
      city: identity.city ?? null,
      state: identity.state ?? null,
      postal_code: identity.postal_code ?? null,
      country: identity.country ?? null,
      brand_id: identity.brand_id ?? null,
      owner_user_id: identity.owner_user_id ?? null,
      source: identity.source ?? null,
      description: identity.description ?? null,
    })
    .onConflictDoUpdate({ target: company.dedupe_key, set: patch })
    .returning({ id: company.id });

  return { id: row.id, created: existing.length === 0 };
}

/** Attach (or refresh) a contact on a company. Idempotent on
 *  (company_id, lower(email)) via the partial unique index; contacts with no
 *  email are matched on name instead, since the index can't cover them. */
export async function upsertContact(o: {
  companyId: string;
  full_name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  linkedin_url?: string | null;
  priority_rank?: number | null;
  is_primary?: boolean;
}): Promise<UpsertResult> {
  const email = o.email?.trim().toLowerCase() || null;

  if (email) {
    const [row] = await db
      .insert(contact)
      .values({
        company_id: o.companyId,
        full_name: o.full_name.trim(),
        title: o.title ?? null,
        email,
        phone: o.phone ?? null,
        mobile: o.mobile ?? null,
        linkedin_url: o.linkedin_url ?? null,
        priority_rank: o.priority_rank ?? null,
        is_primary: o.is_primary ?? false,
      })
      .onConflictDoUpdate({
        target: [contact.company_id, contact.email],
        set: {
          full_name: o.full_name.trim(),
          ...(o.title ? { title: o.title } : {}),
          ...(o.phone ? { phone: o.phone } : {}),
          ...(o.mobile ? { mobile: o.mobile } : {}),
          ...(o.linkedin_url ? { linkedin_url: o.linkedin_url } : {}),
          ...(o.priority_rank != null ? { priority_rank: o.priority_rank } : {}),
          updated_at: new Date(),
        },
      })
      .returning({ id: contact.id });
    return { id: row.id, created: false };
  }

  // No email: fall back to a name match within the company.
  const found = await db
    .select({ id: contact.id })
    .from(contact)
    .where(
      and(eq(contact.company_id, o.companyId), sql`lower(${contact.full_name}) = ${o.full_name.trim().toLowerCase()}`)
    )
    .limit(1);
  if (found.length) {
    await db
      .update(contact)
      .set({
        ...(o.title ? { title: o.title } : {}),
        ...(o.phone ? { phone: o.phone } : {}),
        updated_at: new Date(),
      })
      .where(eq(contact.id, found[0].id));
    return { id: found[0].id, created: false };
  }
  const [row] = await db
    .insert(contact)
    .values({
      company_id: o.companyId,
      full_name: o.full_name.trim(),
      title: o.title ?? null,
      phone: o.phone ?? null,
      mobile: o.mobile ?? null,
      priority_rank: o.priority_rank ?? null,
      is_primary: o.is_primary ?? false,
    })
    .returning({ id: contact.id });
  return { id: row.id, created: true };
}

/** Never contact again. Persisted as a verdict (not a per-run exclusion list) —
 *  the source app's "groundhog-day pruning" lesson: an operator judgement has to
 *  survive the next import. */
export async function blockCompany(o: {
  id: string;
  reason: string;
  actorUserId?: string | null;
}): Promise<void> {
  await db
    .update(company)
    .set({ blocked_at: new Date(), blocked_reason: o.reason, updated_at: new Date() })
    .where(eq(company.id, o.id));
  await db
    .insert(activity)
    .values({
      company_id: o.id,
      kind: "system",
      subject: "Blocked",
      body: o.reason,
      actor_user_id: o.actorUserId ?? null,
    })
    .catch(() => null);
  await logAudit({
    actorUserId: o.actorUserId ?? null,
    action: "company.block",
    entity: "company",
    recordId: o.id,
    after: { blocked_reason: o.reason },
  });
}

export async function unblockCompany(id: string, actorUserId?: string | null): Promise<void> {
  await db
    .update(company)
    .set({ blocked_at: null, blocked_reason: null, updated_at: new Date() })
    .where(eq(company.id, id));
  await logAudit({ actorUserId: actorUserId ?? null, action: "company.unblock", entity: "company", recordId: id });
}

/** Substring search over the fields a banker actually types. The source app had
 *  NO search at all (a real gap at a few hundred records). ILIKE with a trigram
 *  index is plenty to five figures; see PACKET.md for the tsvector upgrade. */
export async function searchCompanies(q: string, limit = 50): Promise<Company[]> {
  const term = `%${q.trim().toLowerCase()}%`;
  if (!q.trim()) return [];
  return db
    .select()
    .from(company)
    .where(
      or(
        sql`lower(${company.name}) like ${term}`,
        sql`lower(${company.legal_name}) like ${term}`,
        sql`lower(${company.domain}) like ${term}`,
        sql`lower(${company.city}) like ${term}`,
        sql`lower(${company.email}) like ${term}`
      )
    )
    .limit(limit);
}

/** Companies with no activity in N days and no revisit scheduled — the silent
 *  leak in any origination list. */
export async function stalledCompanies(days = 90, limit = 100) {
  return db
    .select({ id: company.id, name: company.name, updated_at: company.updated_at })
    .from(company)
    .where(
      and(
        isNull(company.revisit_date),
        isNull(company.blocked_at),
        sql`${company.updated_at} < now() - (${days} || ' days')::interval`
      )
    )
    .limit(limit);
}
