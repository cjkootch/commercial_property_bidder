// The suppression table serves two different jobs and the difference matters
// (2026-07-17 audit): deliverability/abuse rows ("resend bounce", "resend
// complaint") mean the address is broken or hostile — they block marketing AND
// transactions. A marketing opt-out ("one-click unsubscribe") means only "stop
// emailing me" — it must NEVER block a purchase, or every cold prospect who
// taps unsubscribe (or whose mail client auto-fires the RFC 8058 POST) is
// silently barred from ever converting. Campaign engines keep reading the whole
// table (all reasons stop marketing email); transaction gates call this.

import { eq } from "drizzle-orm";
import { db } from "./db";
import { suppression } from "./db/schema";

/** Reasons that stop marketing email but must not block purchases/claims. */
const MARKETING_ONLY_REASONS = new Set(["one-click unsubscribe"]);

/** Pure core, unit-testable: do these suppression rows block transactions? */
export function rowsBlockTransactions(rows: Array<{ reason: string | null }>): boolean {
  return rows.some((r) => !MARKETING_ONLY_REASONS.has(r.reason ?? ""));
}

/**
 * True when this email must not transact (purchase, free claim) — i.e. it has
 * a suppression row that is NOT a mere marketing opt-out. Rows are stored
 * lowercased; match accordingly.
 */
export async function transactionsBlocked(email: string): Promise<boolean> {
  const rows = await db
    .select({ reason: suppression.reason })
    .from(suppression)
    .where(eq(suppression.email, email.toLowerCase()));
  return rowsBlockTransactions(rows);
}
