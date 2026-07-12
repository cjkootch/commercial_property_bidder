// The day-7 outcome loop: buyers unlock a sheet and then nothing ever asks
// how it went. Journey analysis (2026-07-12) showed 4 free unlocks and $0
// revenue with zero signal on whether anyone called the owner, bid, or won —
// no recovery path for a dead contact, and no source of win stories. One
// email per unlock, ever: did you reach out, reply "refresh" if the contact
// didn't pan out, here's the shelf when you're ready for the next one.
// Replies land on the operator (reply-to) — the answers ARE the product
// feedback and, eventually, the testimonials.

import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../db";
import { buyer, emailSend, leadUnlock, property } from "../db/schema";
import { sendEmail } from "../integrations/resend";
import { isPlaceholderEmail, signBuyerUnsub } from "../buyer-auth";
import { getDefaultCompany } from "../db/queries";
import { TRADES, asTrade } from "../leads/trades";
import { siteBase, toHtml } from "./buyer-prospecting";

/** Sheet age before we ask. A week is long enough to have made the call,
 *  short enough that the contact is still fresh if it needs re-verifying. */
export const OUTCOME_AFTER_DAYS = 7;
/** Don't ask about ancient history (backfill guard on first deploy). */
export const OUTCOME_MAX_AGE_DAYS = 21;
export const OUTCOME_MAX_PER_RUN = 50;

const KIND = "outcome_check";

export function buildOutcomeMessage(o: {
  company: string;
  city: string | null;
  trade: string;
  brand: string;
}): { subject: string; body: string } {
  const service = TRADES[asTrade(o.trade)].service;
  const where = o.city ? `${o.city} ` : "";
  const subject = `How'd the ${where}${service} job go?`;
  const body = `${o.company} team —

You unlocked the ${where}${service} job sheet about a week ago. Quick check-in:

- Reached out already? Reply and tell me how it went — it shapes which jobs we send you next.
- Contact didn't pan out? Reply "refresh" and we'll re-verify it for you, free.
- Ready for the next one? Open jobs near you: ${siteBase()}/buyers

This is the only check-in we'll send about this sheet.

— ${o.brand}`;
  return { subject, body };
}

export type OutcomeRunSummary = { scanned: number; sent: number; skipped: number; log: string[] };

/** Find week-old unlocks that never got their check-in and send it. One per
 *  unlock ever (email_send kind+ref dedupe), one per buyer per run. */
export async function runOutcomeChecks(opts?: { limit?: number; apply?: boolean }): Promise<OutcomeRunSummary> {
  const limit = Math.min(opts?.limit ?? OUTCOME_MAX_PER_RUN, 200);
  const apply = opts?.apply ?? false;
  const log: string[] = [];
  const now = Date.now();

  const [unlocks, alreadyChecked] = await Promise.all([
    db
      .select({
        id: leadUnlock.id,
        buyer_id: leadUnlock.buyer_id,
        property_id: leadUnlock.property_id,
        trade: leadUnlock.trade,
        created_at: leadUnlock.created_at,
      })
      .from(leadUnlock)
      .where(
        and(
          gte(leadUnlock.created_at, new Date(now - OUTCOME_MAX_AGE_DAYS * 86_400_000)),
          lte(leadUnlock.created_at, new Date(now - OUTCOME_AFTER_DAYS * 86_400_000))
        )
      ),
    db.select({ ref_id: emailSend.ref_id }).from(emailSend).where(eq(emailSend.kind, KIND)),
  ]);
  const checked = new Set(alreadyChecked.map((r) => r.ref_id));

  const co = await getDefaultCompany();
  const brand = co?.name ?? "Greenkeep";
  const replyEmail = co?.email?.trim() || "";
  let sent = 0;
  let skipped = 0;
  const buyersThisRun = new Set<string>();

  for (const u of unlocks) {
    if (sent >= limit) break;
    if (checked.has(u.id) || buyersThisRun.has(u.buyer_id)) continue;
    const [b] = await db.select().from(buyer).where(eq(buyer.id, u.buyer_id)).limit(1);
    if (!b || !b.notify || isPlaceholderEmail(b.email)) {
      skipped++;
      continue; // phone-only buyers get their check-in by SMS someday, not a bounce
    }
    const [prop] = await db
      .select({ city: property.city })
      .from(property)
      .where(eq(property.id, u.property_id))
      .limit(1);
    const msg = buildOutcomeMessage({
      company: b.company_name,
      city: prop?.city ?? null,
      trade: u.trade,
      brand,
    });
    buyersThisRun.add(u.buyer_id);
    if (!apply) {
      sent++;
      log.push(`  DRY ${b.company_name} <${b.email}> — "${msg.subject}"`);
      continue;
    }
    const unsubUrl = `${siteBase()}/api/unsubscribe?token=${encodeURIComponent(signBuyerUnsub(b.email))}`;
    const res = await sendEmail({
      to: b.email,
      subject: msg.subject,
      html: toHtml(msg.body, unsubUrl, co?.physical_mailing_address ?? null),
      replyTo: replyEmail || undefined,
      tags: { kind: KIND },
      logAs: { kind: KIND, buyerId: b.id, refId: u.id },
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (res.ok) {
      sent++;
      log.push(`  ✓ ${b.company_name} <${b.email}> — outcome check sent`);
    } else {
      skipped++;
      log.push(`  ✗ ${b.company_name} — send failed (${res.error})`);
    }
  }

  if (!apply && sent) log.push(`DRY RUN — ${sent} outcome check(s) would send; pass ?apply=1.`);
  return { scanned: unlocks.length, sent, skipped, log };
}
