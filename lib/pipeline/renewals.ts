// The renewal annuity: commercial service contracts re-bid roughly annually,
// so ~11 months after a lead's spots sell, the SAME property becomes a fresh
// high-intent lead ("the incumbent's contract is up") at zero sourcing cost.
//
// Mechanics: bump property.sale_cycle and clear lead_exported_at — the lead
// returns to every trade's shelf with a fresh per-trade cap (unlock rows keep
// the cycle they were bought in, so history survives). An EXCLUSIVE keeps its
// trade closed across all cycles — that permanence is what the buyer paid for.
// Past buyers get a heads-up alert: their re-bid window is opening, time to
// re-engage the owner they bought last year.

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { buyer, leadUnlock, property } from "../db/schema";
import { displayName } from "../leads/market";
import { sendEmail } from "../integrations/resend";
import { signBuyerUnsub } from "../buyer-auth";
import { TRADES, type Trade } from "../leads/trades";

/** Days after the last current-cycle sale before the re-bid window opens. */
export const RENEW_AFTER_DAYS = 330;
/** Never re-bump a property that was renewed within this window. */
export const RENEW_COOLDOWN_DAYS = 300;

export type RenewalUnlock = {
  cycle: number;
  kind: string;
  trade: string;
  created_at: Date;
};

/** Is this property due for its contract-anniversary reopen? Pure — the
 *  guards are unit-tested: sales old enough, not recently renewed, and at
 *  least one trade that an exclusive hasn't closed forever. */
export function dueForRenewal(
  prop: { sale_cycle: number; renewed_at: Date | null; archived_at: Date | null },
  unlocks: RenewalUnlock[],
  now: Date = new Date()
): boolean {
  if (prop.archived_at) return false;
  const current = unlocks.filter((u) => u.cycle === prop.sale_cycle);
  if (!current.length) return false; // nothing sold this cycle — nothing to renew
  const latest = Math.max(...current.map((u) => u.created_at.getTime()));
  if (now.getTime() - latest < RENEW_AFTER_DAYS * 86400_000) return false;
  if (
    prop.renewed_at &&
    now.getTime() - prop.renewed_at.getTime() < RENEW_COOLDOWN_DAYS * 86400_000
  )
    return false;
  // If every registered trade is closed by an exclusive, there's nothing to
  // reopen — exclusives hold across cycles.
  const exclusiveTrades = new Set(unlocks.filter((u) => u.kind === "exclusive").map((u) => u.trade));
  const trades = Object.keys(TRADES) as Trade[];
  return trades.some((t) => !exclusiveTrades.has(t));
}

export type RenewalRunSummary = {
  candidates: number;
  renewed: number;
  buyersAlerted: number;
  log: string[];
};

export async function runRenewals(opts?: { apply?: boolean }): Promise<RenewalRunSummary> {
  const apply = opts?.apply ?? false;
  const log: string[] = [];
  const now = new Date();

  const props = await db
    .select()
    .from(property)
    .where(isNull(property.archived_at));
  const allUnlocks = await db.select().from(leadUnlock);
  const byProp = new Map<string, typeof allUnlocks>();
  for (const u of allUnlocks) {
    const g = byProp.get(u.property_id);
    if (g) g.push(u);
    else byProp.set(u.property_id, [u]);
  }

  const due = props.filter((p) => dueForRenewal(p, byProp.get(p.id) ?? [], now));
  log.push(`${due.length} lead(s) at their contract anniversary`);
  let renewed = 0;
  let buyersAlerted = 0;

  for (const p of due) {
    const name = displayName(p.name);
    const firstSold = new Date(
      Math.min(...(byProp.get(p.id) ?? []).map((u) => u.created_at.getTime()))
    )
      .toISOString()
      .slice(0, 10);
    if (!apply) {
      log.push(`  DRY ${name} — sold ${firstSold}, would reopen as cycle ${p.sale_cycle + 1}`);
      continue;
    }

    await db
      .update(property)
      .set({
        sale_cycle: p.sale_cycle + 1,
        lead_exported_at: null,
        lead_buyer: null,
        renewed_at: now,
        notes: `${p.notes ?? ""} Contract anniversary: first sold ${firstSold} — the incumbent's contract is up for re-bid.`.trim(),
        updated_at: now,
      })
      .where(and(eq(property.id, p.id), eq(property.sale_cycle, p.sale_cycle)));
    renewed++;
    log.push(`  ↻ ${name} — reopened as cycle ${p.sale_cycle + 1}`);

    // Heads-up to the companies that bought it last year: their re-bid
    // window is opening — re-engage the owner before someone new does.
    const holders = byProp.get(p.id) ?? [];
    for (const u of holders) {
      const [b] = await db.select().from(buyer).where(eq(buyer.id, u.buyer_id)).limit(1);
      if (!b?.notify || !b.email) continue;
      const res = await sendEmail({
        to: b.email,
        subject: `Re-bid window opening — the ${p.city ?? "area"} job you bought is up for renewal`,
        html:
          `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;line-height:1.55;">` +
          `<p>${b.company_name} team —</p>` +
          `<p>About a year ago you unlocked <strong>${name}</strong>${p.city ? ` (${p.city})` : ""}. Commercial contracts typically re-bid annually — which means the owner's decision window is opening again <em>right now</em>.</p>` +
          `<p>Your sheet, contacts, and intro letter are still in your dashboard. If you won it: lock in the renewal before anyone else calls. If you didn't: this is the rematch.</p>` +
          `<p><a href="https://greenkeep.us/buyers" style="color:#2f7d4f;font-weight:600;">Open your dashboard</a></p>` +
          `<p style="color:#9ca3af;font-size:11px;"><a href="https://greenkeep.us/api/unsubscribe?token=${encodeURIComponent(signBuyerUnsub(b.email))}" style="color:#9ca3af;">Unsubscribe</a></p></div>`,
        tags: { kind: "renewal_alert" },
      });
      if (res.ok) buyersAlerted++;
    }
  }

  if (!apply && due.length) {
    log.push("DRY RUN — pass ?apply=1 (or set RENEWALS_AUTORUN=1) to reopen these leads.");
  }
  return { candidates: due.length, renewed, buyersAlerted, log };
}
