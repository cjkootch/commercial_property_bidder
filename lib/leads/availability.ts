// The scarcity rule for the lead marketplace, in ONE place so every sales
// channel (free claim, Stripe checkout, webhook, operator CSV export, campaign
// kit) agrees:
//
//   - A lead sells to at most LEAD_MAX_BUYERS companies PER TRADE (default 3)
//     at the standard price. The cap is disclosed to buyers ("capped at 3
//     landscaping companies") — trades don't compete, so per-trade caps keep
//     the scarcity promise honest while the same signal sells to each vertical.
//   - While NOBODY in a trade has it yet, one buyer can pay the exclusive
//     premium to close it outright — within that trade.
//   - A lead is CLOSED for a trade once that trade's cap fills or its
//     exclusive sells. The property-wide lead_exported_at stamp (operator CSV
//     export) closes it for every trade; the automatic stamp only lands when
//     ALL registered trades are closed.
//   - RENEWALS: contracts re-bid annually, so the renewal cron bumps
//     property.sale_cycle and clears lead_exported_at ~11 months after a
//     sale. Cap counting is WITHIN the current cycle (fresh spots each
//     anniversary), but an EXCLUSIVE closes its trade across ALL cycles —
//     "yours alone, permanently" is the promise the buyer paid for.
//
// Neon's HTTP driver has no transactions, so cap races are handled optimistically:
// insert first, then confirmUnlockWithinCap() re-reads and rolls back the rows
// that landed over the cap (deterministic order: created_at, then id).

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { buyer, leadUnlock, property, type Property } from "../db/schema";
import { DEFAULT_TRADE, TRADES, type Trade } from "./trades";

export function leadMaxBuyers(): number {
  const n = Number(process.env.LEAD_MAX_BUYERS);
  return Number.isInteger(n) && n >= 1 ? n : 3;
}

export type LeadAvailability = {
  /** at least one shared spot left */
  open: boolean;
  /** nobody has it yet — the exclusive option is still on the table */
  exclusiveOpen: boolean;
  spotsLeft: number;
  /** exported, exclusive sold, or cap reached */
  closed: boolean;
};

export async function leadAvailability(
  prop: Pick<Property, "id" | "lead_exported_at"> & {
    sale_cycle?: number;
    archived_at?: Date | null;
  },
  trade: Trade = DEFAULT_TRADE
): Promise<LeadAvailability> {
  const closed: LeadAvailability = { open: false, exclusiveOpen: false, spotsLeft: 0, closed: true };
  // Archived = the operator pulled it — closed everywhere (claim tokens and
  // nudges included), not just off the shelf.
  if (prop.lead_exported_at != null || prop.archived_at != null) return closed;
  const cycle = prop.sale_cycle ?? 0;
  const all = (
    await db.select().from(leadUnlock).where(eq(leadUnlock.property_id, prop.id))
  ).filter((u) => u.trade === trade);
  // An exclusive closes its trade forever — including future renewal cycles.
  if (all.some((u) => u.kind === "exclusive")) return closed;
  const unlocks = all.filter((u) => u.cycle === cycle);
  const spotsLeft = Math.max(0, leadMaxBuyers() - unlocks.length);
  // The exclusive pitch is "yours alone — nobody else has this sheet". A
  // renewal cycle reopens SHARED spots, but prior-cycle holders still own the
  // identical sheet, so the exclusive is only honest when NOBODY ever held it.
  return { open: spotsLeft > 0, exclusiveOpen: all.length === 0, spotsLeft, closed: spotsLeft === 0 };
}

/**
 * Post-insert cap check for the no-transaction race window. Re-reads this
 * TRADE's unlocks for the property in deterministic order; if this row landed
 * past the trade's cap in ITS CYCLE (or after someone else's exclusive in any
 * cycle, or alongside another row when it IS the exclusive), it is deleted.
 * Returns true when the unlock stands.
 */
export async function confirmUnlockWithinCap(unlockId: string, propertyId: string): Promise<boolean> {
  const all = await db
    .select()
    .from(leadUnlock)
    .where(eq(leadUnlock.property_id, propertyId))
    .orderBy(asc(leadUnlock.created_at), asc(leadUnlock.id));
  const mine = all.find((r) => r.id === unlockId);
  if (!mine) return false;
  // The cap race is within the trade — rows from other trades never block.
  const tradeRows = all.filter((r) => r.trade === mine.trade);
  // Exclusives block their trade across every cycle.
  const exclusiveBeforeMine = tradeRows.some(
    (r) => r.kind === "exclusive" && r.id !== mine.id && tradeRows.indexOf(r) < tradeRows.indexOf(mine)
  );
  // Cap/free counting happens within the row's own cycle.
  const rows = tradeRows.filter((r) => r.cycle === mine.cycle);
  const idx = rows.findIndex((r) => r.id === unlockId);
  const before = rows.slice(0, idx);
  const ok =
    mine.kind === "exclusive"
      ? idx === 0 && !exclusiveBeforeMine
      : idx < leadMaxBuyers() &&
        !exclusiveBeforeMine &&
        !before.some((r) => r.kind === "exclusive") &&
        // Free cap (allocation.FREE_MAX_PER_LEAD = 1, per trade) re-checked
        // post-insert: two concurrent free claims must not both survive.
        (mine.kind !== "free" || !before.some((r) => r.kind === "free"));
  if (!ok) await db.delete(leadUnlock).where(eq(leadUnlock.id, unlockId));
  return ok;
}

/**
 * Stamp the property closed (lead_exported_at + lead_buyer) once EVERY
 * registered trade is done for the CURRENT cycle (cap full or exclusive
 * sold). Safe to call after every unlock; no-ops while any trade still has
 * spots. Never overwrites an existing stamp. The renewal cron clears the
 * stamp and bumps the cycle when the anniversary arrives.
 */
export async function closeLeadIfDone(propertyId: string): Promise<void> {
  const [prop] = await db
    .select({ sale_cycle: property.sale_cycle })
    .from(property)
    .where(eq(property.id, propertyId))
    .limit(1);
  const cycle = prop?.sale_cycle ?? 0;
  const rows = await db.select().from(leadUnlock).where(eq(leadUnlock.property_id, propertyId));
  const cap = leadMaxBuyers();
  const trades = Object.keys(TRADES) as Trade[];
  const doneFor = (t: Trade) => {
    const mine = rows.filter((r) => r.trade === t);
    // Any-cycle exclusive keeps the trade closed; the cap counts this cycle.
    return (
      mine.some((r) => r.kind === "exclusive") ||
      mine.filter((r) => r.cycle === cycle).length >= cap
    );
  };
  if (!trades.every(doneFor)) return;
  const excl = rows.find((r) => r.kind === "exclusive");
  let label = `${rows.length} companies (shared cap)`;
  if (excl) {
    const [b] = await db.select().from(buyer).where(eq(buyer.id, excl.buyer_id)).limit(1);
    label = `${b?.company_name ?? "exclusive buyer"} (exclusive)`;
  }
  await db
    .update(property)
    .set({ lead_exported_at: new Date(), lead_buyer: label, updated_at: new Date() })
    .where(and(eq(property.id, propertyId), isNull(property.lead_exported_at)));
}
