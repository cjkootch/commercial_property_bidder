// 24h loss-aversion reservation for the free spot on a lead+trade. When a
// pitched company opens their claim link, we HOLD the free spot for them for
// HOLD_TTL_HOURS; others see it as taken until it expires or they claim. This
// makes the pitch's "held for you, or it goes to the next company" literally
// true (endowment effect), rather than manufactured urgency — the loss is real
// because the marketplace is genuinely capped and first-come.
//
// Expiry is lazy: a row whose expires_at is in the past is simply not "live".
// One free spot per lead+trade (allocation.FREE_MAX_PER_LEAD = 1), so the hold
// is unique on (property, trade) — the first opener wins it.

import { and, eq, lt } from "drizzle-orm";
import { db } from "../db";
import { leadHold } from "../db/schema";
import { companyKey } from "./companies";
import type { Trade } from "./trades";

export const HOLD_TTL_HOURS = 24;

/** When a hold placed now would expire. */
export function holdExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + HOLD_TTL_HOURS * 3_600_000);
}

type HoldLike = { company: string; expires_at: Date } | null | undefined;

/** Pure: is the free spot live-held by SOMEONE ELSE (not `myKey`)? Drives
 *  whether a viewer can free-claim and what the claim page says. */
export function heldByOther(hold: HoldLike, myKey: string | null, now: Date = new Date()): boolean {
  if (!hold) return false;
  if (hold.expires_at.getTime() <= now.getTime()) return false; // expired = released
  return hold.company !== (myKey ?? "");
}

/** Pure: is the free spot live-held FOR `myKey` (their reservation to claim)? */
export function heldForMe(hold: HoldLike, myKey: string | null, now: Date = new Date()): boolean {
  if (!hold || !myKey) return false;
  if (hold.expires_at.getTime() <= now.getTime()) return false;
  return hold.company === myKey;
}

/** The live hold row for a lead+trade, or null if none/expired. */
export async function liveHold(propertyId: string, trade: Trade, now: Date = new Date()) {
  const [row] = await db
    .select()
    .from(leadHold)
    .where(and(eq(leadHold.property_id, propertyId), eq(leadHold.trade, trade)))
    .limit(1);
  if (!row) return null;
  return row.expires_at.getTime() > now.getTime() ? row : null;
}

/**
 * Reserve the free spot for `company` when they open the lead — unless it's
 * already live-held by another company (then no-op; they keep first place).
 * Clears an expired row first so a released spot can be re-held. Best-effort;
 * a hold failure must never break the claim page. Returns the holder's key.
 */
export async function reserveHold(
  propertyId: string,
  trade: Trade,
  companyName: string | null,
  now: Date = new Date()
): Promise<void> {
  const key = companyName ? companyKey(companyName) : null;
  if (!key) return;
  try {
    // Release an expired hold on this slot so it can be re-reserved.
    await db
      .delete(leadHold)
      .where(and(eq(leadHold.property_id, propertyId), eq(leadHold.trade, trade), lt(leadHold.expires_at, now)));
    // First live opener wins; a still-live hold (theirs or another's) survives
    // via the unique(property, trade) conflict.
    await db
      .insert(leadHold)
      .values({ property_id: propertyId, trade, company: key, expires_at: holdExpiry(now) })
      .onConflictDoNothing({ target: [leadHold.property_id, leadHold.trade] });
  } catch {
    /* best-effort: never block the render on a hold write */
  }
}

/** Consume the hold once the holder actually claims the free spot. */
export async function releaseHold(propertyId: string, trade: Trade): Promise<void> {
  await db
    .delete(leadHold)
    .where(and(eq(leadHold.property_id, propertyId), eq(leadHold.trade, trade)))
    .catch(() => {});
}
