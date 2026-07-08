// The scarcity rule for the lead marketplace, in ONE place so every sales
// channel (free claim, Stripe checkout, webhook, operator CSV export, campaign
// kit) agrees:
//
//   - A lead sells to at most LEAD_MAX_BUYERS companies (default 3) at the
//     standard price. The cap is disclosed to buyers — that's what keeps the
//     scarcity credible.
//   - While NOBODY has it yet, one buyer can pay the exclusive premium to
//     close it outright.
//   - A lead is CLOSED once the cap fills, an exclusive sells, or the operator
//     exports it (lead_exported_at doubles as the closed flag).
//
// Neon's HTTP driver has no transactions, so cap races are handled optimistically:
// insert first, then confirmUnlockWithinCap() re-reads and rolls back the rows
// that landed over the cap (deterministic order: created_at, then id).

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { buyer, leadUnlock, property, type Property } from "../db/schema";

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

export async function leadAvailability(prop: Pick<Property, "id" | "lead_exported_at">): Promise<LeadAvailability> {
  const closed: LeadAvailability = { open: false, exclusiveOpen: false, spotsLeft: 0, closed: true };
  if (prop.lead_exported_at != null) return closed;
  const unlocks = await db.select().from(leadUnlock).where(eq(leadUnlock.property_id, prop.id));
  if (unlocks.some((u) => u.kind === "exclusive")) return closed;
  const spotsLeft = Math.max(0, leadMaxBuyers() - unlocks.length);
  return { open: spotsLeft > 0, exclusiveOpen: unlocks.length === 0, spotsLeft, closed: spotsLeft === 0 };
}

/**
 * Post-insert cap check for the no-transaction race window. Re-reads all
 * unlocks for the property in deterministic order; if this row landed past the
 * cap (or after someone else's exclusive, or alongside another row when it IS
 * the exclusive), it is deleted. Returns true when the unlock stands.
 */
export async function confirmUnlockWithinCap(unlockId: string, propertyId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(leadUnlock)
    .where(eq(leadUnlock.property_id, propertyId))
    .orderBy(asc(leadUnlock.created_at), asc(leadUnlock.id));
  const idx = rows.findIndex((r) => r.id === unlockId);
  if (idx === -1) return false;
  const mine = rows[idx];
  const before = rows.slice(0, idx);
  const ok =
    mine.kind === "exclusive"
      ? idx === 0
      : idx < leadMaxBuyers() &&
        !before.some((r) => r.kind === "exclusive") &&
        // Free cap (allocation.FREE_MAX_PER_LEAD = 1) re-checked post-insert:
        // two concurrent free claims must not both survive the pre-read.
        (mine.kind !== "free" || !before.some((r) => r.kind === "free"));
  if (!ok) await db.delete(leadUnlock).where(eq(leadUnlock.id, unlockId));
  return ok;
}

/**
 * Stamp the property closed (lead_exported_at + lead_buyer) once the cap is
 * full or an exclusive sold. Safe to call after every unlock; no-ops while
 * spots remain. Never overwrites an existing stamp.
 */
export async function closeLeadIfDone(propertyId: string): Promise<void> {
  const rows = await db.select().from(leadUnlock).where(eq(leadUnlock.property_id, propertyId));
  const excl = rows.find((r) => r.kind === "exclusive");
  if (!excl && rows.length < leadMaxBuyers()) return;
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
