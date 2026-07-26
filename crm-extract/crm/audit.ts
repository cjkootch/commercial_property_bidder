// Audit trail. NEW — the source app had none (its nearest analogue, claim_event,
// logged anonymous funnel steps with a hashed IP). An advisory firm needs
// who-changed-what: who moved the deal, who edited the revisit, who ran the
// import that overwrote 400 rows.
//
// Deliberately NOT a trigger-based full-row history: this logs changed fields
// only, from the app layer, because the questions people actually ask are about
// intent ("who pushed this to 2028?") not byte-level diffs.

import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog } from "../db/schema";

/** Best-effort: an audit write must never fail the operation it describes. A
 *  lost audit line is bad; a failed stage change because the audit table was
 *  locked is worse. */
export async function logAudit(o: {
  actorUserId?: string | null;
  action: string;
  entity: string;
  recordId?: string | null;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actor_user_id: o.actorUserId ?? null,
      action: o.action,
      entity: o.entity,
      record_id: o.recordId ?? null,
      before: (o.before ?? null) as never,
      after: (o.after ?? null) as never,
    });
  } catch (e) {
    console.error(`audit log failed (${o.action}):`, e);
  }
}

/** PURE. Field-level diff of two shallow objects — feed the result to logAudit
 *  so the row carries only what changed. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>
): { before: Partial<T>; after: Partial<T>; changed: boolean } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    const from = before[k];
    const to = after[k];
    const same =
      from === to ||
      (from instanceof Date && to instanceof Date && from.getTime() === to.getTime());
    if (!same) {
      b[k] = from;
      a[k] = to;
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}

/** History for one record, newest first — renders as a "changes" tab. */
export async function recordHistory(entity: string, recordId: string, limit = 100) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entity, entity), eq(auditLog.record_id, recordId)))
    .orderBy(desc(auditLog.created_at))
    .limit(limit);
}
