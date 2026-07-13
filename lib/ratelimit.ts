// Fixed-window rate limiting + tenant usage metering on Postgres (one upsert
// per check — serverless-friendly, no Redis). Protects the public quote
// endpoints from abuse (each call costs Mapbox/geocode/county quota) and caps
// per-tenant spend so white-label traffic can't burn the margin.
//
// FAIL-SOFT: a DB hiccup must not break the quote funnel, but it also must not
// remove the cost ceiling entirely — the estimate endpoint spends Mapbox/
// geocode money per call, so an unbounded fail-OPEN turns a DB degradation into
// an unbounded bill. On DB error we fall back to a per-instance in-memory
// counter: coarse (the effective cap is this-limit × live instances, and it
// resets on cold start) but it closes the runaway-spend hole for free.

import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "./db";
import { usageCounter } from "./db/schema";

/** Start of the current fixed window for a given size, as a Date. */
export function windowStart(windowSec: number, now = Date.now()): Date {
  const ms = windowSec * 1000;
  return new Date(Math.floor(now / ms) * ms);
}

export type LimitResult = { ok: boolean; count: number };

// Per-instance fallback counters, used only when the Postgres path throws.
// Keyed by `${key}:${windowStartMs}`; the Map is swept when it grows so a
// long-lived instance under sustained DB failure can't leak memory.
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

/**
 * Count a hit against `key` in the current window and check it against
 * `limit`. Returns ok=false when the limit is exceeded. On a DB error, falls
 * back to a per-instance in-memory cap (fail-soft) rather than fail-open.
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<LimitResult> {
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
    return memRateLimit(key, limit, windowSec); // fail-soft, not fail-open
  }
}

/** Best-effort client IP for server actions / route handlers behind Vercel.
 *  SECURITY ASSUMPTION: takes the LEFTMOST x-forwarded-for entry, which is
 *  client-spoofable in general — it is only trustworthy because Vercel's edge
 *  OVERWRITES this header with the real client IP before our code runs. If this
 *  app is ever deployed behind a different/additional proxy, IP-keyed rate
 *  limits become spoofable; use the platform's verified client-IP header there. */
export function clientIp(): string {
  try {
    const h = headers();
    const fwd = h.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0].trim();
    return h.get("x-real-ip")?.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

// Public-funnel limits. Generous for humans, hostile to scripts. The instant
// estimate is the expensive call (geocode + county GIS + Mapbox imagery +
// email), so it gets the tightest cap.
export const LIMITS = {
  estimate_ip: { limit: 8, windowSec: 3600 },
  geocode_ip: { limit: 60, windowSec: 3600 },
  suggest_ip: { limit: 300, windowSec: 3600 },
  preview_ip: { limit: 60, windowSec: 3600 },
  intake_ip: { limit: 10, windowSec: 3600 },
  /** Per-tenant measured-quote budget per day — bounds Mapbox spend per tenant.
   *  Over budget, quotes degrade to lead-capture (cheap) instead of failing. */
  tenant_quotes_day: { limit: 300, windowSec: 86400 },
} as const;

/** Prune counter windows older than two days (called from the pipeline runner). */
export async function pruneUsageCounters(): Promise<void> {
  try {
    await db.delete(usageCounter).where(sql`${usageCounter.window_start} < now() - interval '2 days'`);
  } catch {
    // best-effort
  }
}
