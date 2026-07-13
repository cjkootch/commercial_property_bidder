// Market-activity social proof: real, recent claim activity in a prospect's
// city, shown at the decision moment to make the (genuine) scarcity felt.
// "Companies near you are grabbing these" is honest here — the counts come
// straight from lead_unlock, the caps are hard, and we only ever show a number
// that actually happened. No fabricated "N people viewing now."

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { leadUnlock, property } from "../db/schema";

export const CITY_CLAIM_WINDOW_DAYS = 30;

/** Distinct companies that claimed a lead in `city` within the window. Case-
 *  insensitive city match (the data holds both "Houston" and "HOUSTON"). */
export async function cityClaimCount(
  city: string | null | undefined,
  days: number = CITY_CLAIM_WINDOW_DAYS,
  now: Date = new Date()
): Promise<number> {
  if (!city?.trim()) return 0;
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await db
    .select({ buyer_id: leadUnlock.buyer_id })
    .from(leadUnlock)
    .innerJoin(property, eq(leadUnlock.property_id, property.id))
    .where(
      and(
        gte(leadUnlock.created_at, since),
        sql`lower(${property.city}) = lower(${city.trim()})`
      )
    );
  return new Set(rows.map((r) => r.buyer_id)).size;
}

/** The scarcity line, or null when there's nothing true to say (0 claims or no
 *  city). Pure + testable — the copy that turns a real count into urgency. */
export function cityScarcityLine(n: number, city: string | null | undefined): string | null {
  if (!city?.trim() || n < 1) return null;
  // City is stored inconsistently ("Houston" / "HOUSTON") — title-case for display.
  const label = city
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
  const companies = n === 1 ? "company" : "companies";
  const has = n === 1 ? "has" : "have";
  return `${n} ${companies} near ${label} ${has} claimed a lead in the last month. Spots are capped — when a job's taken, it's gone.`;
}
