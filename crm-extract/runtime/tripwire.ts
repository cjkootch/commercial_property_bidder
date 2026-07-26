// "Healthy but producing nothing" detection.
//
// The source app learned this the expensive way: its outreach volume decayed
// 45 → 45 → 25 → 18 → 0 across a week in which EVERY cron run reported success.
// The failure alerts only covered thrown exceptions, so a pipeline that was
// starving looked identical to a pipeline with nothing to do. Nobody found out
// until a human happened to ask.
//
// The CRM analogue is worse, because the output is invisible by nature: if the
// revisit sweep stops running, no email arrives — and "no revisits due today"
// also produces no email. Two independent checks:
//
//   1. HEARTBEAT — the sweep stamps `recordHeartbeat` on every run. A separate
//      daily check pages if the stamp is stale. Catches a dead cron, a rotated
//      CRON_SECRET, a deleted schedule.
//   2. CONTRADICTION — the sweep surfaced 0 items while the read side says N are
//      overdue. Catches a sweep that runs and silently does nothing.

import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { usageCounter } from "../db/schema";
import { oncePerDay } from "./ratelimit";
import { alertOps } from "../email/alerts";

const HEARTBEAT_PREFIX = "heartbeat:";

/** Stamp "this job ran" — call at the END of every scheduled job. */
export async function recordHeartbeat(job: string, now: Date = new Date()): Promise<void> {
  try {
    await db
      .insert(usageCounter)
      .values({ key: `${HEARTBEAT_PREFIX}${job}`, window_start: now, count: 1 })
      .onConflictDoNothing({ target: [usageCounter.key, usageCounter.window_start] });
  } catch {
    /* best-effort — a missing heartbeat only costs a false alert */
  }
}

/** Age in hours of a job's most recent heartbeat, or null if it has never run.
 *  NOTE: heartbeats are written into the counter table's window_start column, so
 *  pruneUsageCounters() (2-day horizon) will reclaim them — which is fine, since
 *  anything older than 2 days is already an alert. */
export async function heartbeatAgeHours(job: string, now: Date = new Date()): Promise<number | null> {
  const rows = await db
    .select({ at: usageCounter.window_start })
    .from(usageCounter)
    .where(eq(usageCounter.key, `${HEARTBEAT_PREFIX}${job}`))
    .orderBy(desc(usageCounter.window_start))
    .limit(1);
  if (!rows.length) return null;
  return (now.getTime() - rows[0].at.getTime()) / 3_600_000;
}

/** PURE. Should a stale heartbeat page? `null` age (never ran) counts as stale
 *  only once the grace period since deploy has passed — the caller decides that
 *  by passing `treatMissingAsStale`. */
export function isStale(ageHours: number | null, maxAgeHours: number, treatMissingAsStale = true): boolean {
  if (ageHours === null) return treatMissingAsStale;
  return ageHours > maxAgeHours;
}

/** Page once per day if a job's heartbeat has gone stale. */
export async function checkHeartbeat(o: {
  job: string;
  maxAgeHours: number;
  now?: Date;
}): Promise<{ stale: boolean; ageHours: number | null }> {
  const now = o.now ?? new Date();
  const ageHours = await heartbeatAgeHours(o.job, now);
  const stale = isStale(ageHours, o.maxAgeHours);
  if (stale && (await oncePerDay(`heartbeat_alert:${o.job}`, now))) {
    await alertOps(`🔴 job not running: ${o.job}`, [
      ageHours === null
        ? `${o.job} has no recorded run at all.`
        : `${o.job} last ran ${ageHours.toFixed(1)}h ago (threshold ${o.maxAgeHours}h).`,
      "Check the cron schedule and that CRON_SECRET matches the deployment.",
    ]).catch(() => {});
  }
  return { stale, ageHours };
}

/** PURE. Did a run contradict itself — nothing surfaced while work was waiting? */
export function isContradiction(surfaced: number, outstanding: number): boolean {
  return surfaced === 0 && outstanding > 0;
}

/** Page once per day when a sweep produced nothing despite outstanding work. */
export async function checkSweepOutput(o: {
  job: string;
  surfaced: number;
  outstanding: number;
  now?: Date;
}): Promise<void> {
  if (!isContradiction(o.surfaced, o.outstanding)) return;
  if (!(await oncePerDay(`quiet_alert:${o.job}`, o.now ?? new Date()))) return;
  await alertOps(`📉 ${o.job} surfaced nothing`, [
    `${o.job} completed without surfacing anything, but ${o.outstanding} item(s) are outstanding.`,
    "Likely causes: every item already marked surfaced, all owners disabled, or a filter regression.",
  ]).catch(() => {});
}

/** Convenience: how many usage-counter rows exist for a key prefix. Useful in
 *  an ops page ("how many revisits have ever been surfaced?"). */
export async function countMarkers(prefix: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(usageCounter)
    .where(sql`${usageCounter.key} like ${prefix + "%"}`);
  return row?.n ?? 0;
}
