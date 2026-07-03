// Fixed-window rate limiting + tenant usage metering on Postgres (one upsert
// per check — serverless-friendly, no Redis). Protects the public quote
// endpoints from abuse (each call costs Mapbox/geocode/county quota) and caps
// per-tenant spend so white-label traffic can't burn the margin.
//
// FAIL-OPEN: a DB hiccup must not break the quote funnel — on error the check
// allows the request. The counters are a cost guardrail, not a security
// boundary.

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

/**
 * Count a hit against `key` in the current window and check it against
 * `limit`. Returns ok=false when the limit is exceeded.
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
    return { ok: true, count: 0 }; // fail-open
  }
}

/** Best-effort client IP for server actions / route handlers behind Vercel. */
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
