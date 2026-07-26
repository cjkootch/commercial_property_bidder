// Fixed-window rate limiting + idempotency markers on Postgres — one upsert per
// check, no Redis. Ported from the source app's lib/ratelimit.ts, which used it
// to bound API spend on public endpoints and (via `onceEver`) to get
// exactly-once semantics on a driver with no transactions.
//
// FAIL-SOFT, NOT FAIL-OPEN: a DB hiccup must not break the app, but must not
// remove the ceiling either. On error we fall back to a per-instance in-memory
// counter — coarse (effective limit is limit × live instances, resets on cold
// start) but it still closes the runaway hole.

import { sql } from "drizzle-orm";
import { db } from "../db";
import { usageCounter } from "../db/schema";

/** Start of the current fixed window for a given size, as a Date. */
export function windowStart(windowSec: number, now = Date.now()): Date {
  const ms = windowSec * 1000;
  return new Date(Math.floor(now / ms) * ms);
}

export type LimitResult = { ok: boolean; count: number };

const memCounters = new Map<string, number>();
function memRateLimit(key: string, limit: number, windowSec: number): LimitResult {
  const ws = windowStart(windowSec).getTime();
  const bucket = `${key}:${ws}`;
  const count = (memCounters.get(bucket) ?? 0) + 1;
  memCounters.set(bucket, count);
  if (memCounters.size > 5000) {
    for (const k of memCounters.keys()) {
      if (!k.endsWith(`:${ws}`)) memCounters.delete(k); // drop stale windows
    }
  }
  return { ok: count <= limit, count };
}

/** Count a hit against `key` in the current window and check it against
 *  `limit`. Returns ok=false when exceeded. */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number
): Promise<LimitResult> {
  try {
    const ws = windowStart(windowSec);
    const [row] = await db
      .insert(usageCounter)
      .values({ key, window_start: ws, count: 1 })
      .onConflictDoUpdate({
        target: [usageCounter.key, usageCounter.window_start],
        set: { count: sql`${usageCounter.count} + 1` },
      })
      .returning({ count: usageCounter.count });
    return { ok: (row?.count ?? 1) <= limit, count: row?.count ?? 1 };
  } catch {
    return memRateLimit(key, limit, windowSec);
  }
}

/** Non-incrementing read of the current window's count. Use to peek "is there
 *  budget left?" BEFORE spending money on work a later reservation would
 *  reject. Fail-soft: a DB error reads as 0. */
export async function rateLimitCount(key: string, windowSec: number): Promise<number> {
  try {
    const ws = windowStart(windowSec);
    const [row] = await db
      .select({ count: usageCounter.count })
      .from(usageCounter)
      .where(sql`${usageCounter.key} = ${key} and ${usageCounter.window_start} = ${ws}`)
      .limit(1);
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

/** Refund one hit — for a slot reserved against an action that then FAILED
 *  (e.g. a send that errored). Floors at 0; best-effort. */
export async function releaseRateLimit(key: string, windowSec: number): Promise<void> {
  try {
    const ws = windowStart(windowSec);
    await db
      .update(usageCounter)
      .set({ count: sql`greatest(${usageCounter.count} - 1, 0)` })
      .where(sql`${usageCounter.key} = ${key} and ${usageCounter.window_start} = ${ws}`);
  } catch {
    /* best-effort */
  }
}

/** Far-future sentinel window: the counter pruner drops PAST windows, so a
 *  marker parked here survives forever. */
export const FOREVER_WINDOW = new Date("2099-01-01T00:00:00Z");

/**
 * ONCE-EVER claim. Returns true to exactly one caller for a given key, ever —
 * including across concurrent invocations, because the guarantee is a primary-key
 * insert, not a read-then-write. This is the substitute for a transaction on the
 * Neon HTTP driver, and it is how the revisit sweep, webhook handlers and
 * one-shot notifications avoid double-firing.
 *
 * FAILS OPEN (returns true) if the DB is unreachable: for the notification paths
 * that use it, a duplicate email is a smaller harm than a silently dropped one.
 * Do NOT use it as the sole guard on anything that spends money.
 */
export async function onceEver(key: string): Promise<boolean> {
  try {
    const rows = await db
      .insert(usageCounter)
      .values({ key, window_start: FOREVER_WINDOW, count: 1 })
      .onConflictDoNothing({ target: [usageCounter.key, usageCounter.window_start] })
      .returning();
    return rows.length > 0;
  } catch (e) {
    console.error(`onceEver(${key}) failed open:`, e);
    return true;
  }
}

/** Once per key per UTC day (digests, daily caps). Same mechanics as onceEver
 *  with a day-bucketed window, so the pruner reclaims it eventually. */
export async function oncePerDay(key: string, now: Date = new Date()): Promise<boolean> {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  try {
    const rows = await db
      .insert(usageCounter)
      .values({ key, window_start: day, count: 1 })
      .onConflictDoNothing({ target: [usageCounter.key, usageCounter.window_start] })
      .returning();
    return rows.length > 0;
  } catch {
    return true;
  }
}

/** Prune counter windows older than two days. Call from any daily cron. Never
 *  touches the FOREVER_WINDOW markers. */
export async function pruneUsageCounters(): Promise<void> {
  try {
    await db
      .delete(usageCounter)
      .where(sql`${usageCounter.window_start} < now() - interval '2 days'`);
  } catch {
    /* best-effort */
  }
}
