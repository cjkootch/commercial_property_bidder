// Suppression, with the distinction that matters.
//
// The source app conflated two different things in one table and it cost real
// money: a paying customer who clicked "unsubscribe from alerts" was added to
// the same suppression list that gates PURCHASES, so they were silently barred
// from ever buying again — and so was every cold prospect who opted out of
// marketing and later wanted to convert. (lib/suppression.ts, 2026-07-17.)
//
// The rule: a MARKETING opt-out stops bulk/outreach email only. A deliverability
// or abuse signal (hard bounce, spam complaint) stops everything, because the
// address is broken or hostile. Reasons are data, so the distinction survives.

import { eq } from "drizzle-orm";
import { db } from "../db";
import { suppression } from "../db/schema";

/** Reasons that stop marketing/outreach but must NOT block transactional mail
 *  (a reply, a document, a meeting confirmation) to a live relationship. */
export const MARKETING_ONLY_REASONS = new Set(["unsubscribe", "one-click unsubscribe", "manual opt-out"]);

/** PURE, unit-testable: do these suppression rows block transactional sends? */
export function rowsBlockTransactional(rows: Array<{ reason: string | null }>): boolean {
  return rows.some((r) => !MARKETING_ONLY_REASONS.has(r.reason ?? ""));
}

/** True when the address must not receive ANY email (bounce/complaint). */
export async function transactionalBlocked(email: string): Promise<boolean> {
  const rows = await db
    .select({ reason: suppression.reason })
    .from(suppression)
    .where(eq(suppression.email, email.toLowerCase()));
  return rowsBlockTransactional(rows);
}

/** True when the address must not receive OUTREACH email — any row at all. */
export async function marketingBlocked(email: string): Promise<boolean> {
  const rows = await db
    .select({ id: suppression.id })
    .from(suppression)
    .where(eq(suppression.email, email.toLowerCase()))
    .limit(1);
  return rows.length > 0;
}

export async function suppress(email: string, reason: string): Promise<void> {
  await db
    .insert(suppression)
    .values({ email: email.toLowerCase().trim(), reason })
    .onConflictDoNothing({ target: suppression.email });
}

/** Bulk load for a send loop — one query instead of N. Returns lowercased
 *  addresses; check membership before every recipient. */
export async function loadSuppressed(): Promise<Set<string>> {
  const rows = await db.select({ email: suppression.email }).from(suppression);
  return new Set(rows.map((r) => r.email.toLowerCase()));
}
