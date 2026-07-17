// Per-trade sales cap for residential packages (2026-07-17, launch-eve
// decision): each package sells to at most RESI_MAX_BUYERS companies PER
// TRADE (default 3) — a landscaper and a pest company never compete over the
// same addresses, but the 4th landscaper is turned away. This is what makes
// the pitch's "only N companies get this list" line honest, mirroring the
// commercial side's LEAD_MAX_BUYERS never-oversell rule. Enforced three
// deep: checkout gate (advisory), webhook pre-insert check, and a
// post-insert recount that survives concurrent webhook deliveries (the same
// pattern as confirmUnlockWithinCap on the commercial side — the Neon HTTP
// driver has no transactions).

import { eq } from "drizzle-orm";
import { db } from "../db";
import { residentialUnlock } from "../db/schema";
import type { Trade } from "../leads/trades";

export function resiMaxBuyers(): number {
  const n = Number(process.env.RESI_MAX_BUYERS);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

type UnlockRow = { id: string; trade: string | null; created_at: Date };

/** Pure: rows that count against `trade`'s cap. NULL-trade rows (pre-cap
 *  history) count against every trade — conservative beats oversold. */
export function rowsForTrade<T extends { trade: string | null }>(rows: T[], trade: Trade): T[] {
  return rows.filter((r) => r.trade === null || r.trade === trade);
}

/** Pure: does `unlockId` hold one of the first `cap` spots for its trade?
 *  Deterministic order (created_at, then id) so every concurrent caller
 *  ranks the rows identically and exactly one loser deletes itself. */
export function unlockWithinCap(rows: UnlockRow[], unlockId: string, trade: Trade, cap: number): boolean {
  const ranked = rowsForTrade(rows, trade).sort(
    (a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id)
  );
  return ranked.findIndex((r) => r.id === unlockId) < cap && ranked.some((r) => r.id === unlockId);
}

/** Spots still open on a package for one trade (floor 0). */
export async function packageSpotsLeft(packageId: string, trade: Trade): Promise<number> {
  const rows = await db
    .select({ trade: residentialUnlock.trade })
    .from(residentialUnlock)
    .where(eq(residentialUnlock.residential_package_id, packageId));
  return Math.max(0, resiMaxBuyers() - rowsForTrade(rows, trade).length);
}

/**
 * Post-insert race guard: two payments for the last spot can both pass the
 * pre-insert check; re-read and keep only the first `cap` rows per trade.
 * Returns false (after deleting the row) when this unlock lost the race —
 * the caller converts the payment to account credit.
 */
export async function confirmResidentialWithinCap(
  unlockId: string,
  packageId: string,
  trade: Trade
): Promise<boolean> {
  const rows = await db
    .select({
      id: residentialUnlock.id,
      trade: residentialUnlock.trade,
      created_at: residentialUnlock.created_at,
    })
    .from(residentialUnlock)
    .where(eq(residentialUnlock.residential_package_id, packageId));
  if (unlockWithinCap(rows, unlockId, trade, resiMaxBuyers())) return true;
  await db.delete(residentialUnlock).where(eq(residentialUnlock.id, unlockId));
  return false;
}
