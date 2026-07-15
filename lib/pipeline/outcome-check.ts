// The day-7 outcome loop: buyers unlock a sheet and then nothing ever asks
// how it went. Journey analysis (2026-07-12) showed 4 free unlocks and $0
// revenue with zero signal on whether anyone called the owner, bid, or won —
// no recovery path for a dead contact, and no source of win stories.
//
// Channel-aware (2026-07-15): the check-in rides the channel that actually
// works for that buyer — SMS when their linked prospect company has a
// textable number (replies land in the AI thread, which branches: went well →
// pitch the next lead from live inventory; went nowhere → ask how they worked
// it), email otherwise (replies land on the operator via reply-to). One
// check-in per unlock, ever.

import { and, eq, gte, isNotNull, lte } from "drizzle-orm";
import { db } from "../db";
import { buyer, emailSend, leadUnlock, property, prospectCompany, smsSend } from "../db/schema";
import { sendEmail } from "../integrations/resend";
import { isTextableLineType, sendSms } from "../integrations/twilio";
import { isPlaceholderEmail, signBuyerUnsub } from "../buyer-auth";
import { getDefaultCompany } from "../db/queries";
import { marketTz } from "../markets";
import { rateLimit } from "../ratelimit";
import { TRADES, asTrade } from "../leads/trades";
import { TEXT_QUEUE_DAILY_CAP, withinSmsSendWindow } from "../sms/queue";
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

/** The SMS check-in reads like Cole texting, not a survey. The reply flows
 *  into the AI thread, whose outcome-branch guidance takes it from there. */
export function outcomeSmsFor(o: { city: string | null; trade: string }): string {
  const service = TRADES[asTrade(o.trade)].service;
  const where = o.city ? `${o.city} ` : "";
  return `Hey — checking in on that ${where}${service} job you claimed. Any luck with it?\n-Cole`;
}

/** Pure channel pick: SMS beats email when the buyer's linked prospect
 *  company has a number we'd text (cached line screen, fail-open on
 *  unscreened — this is a warm relationship, not cold outreach). */
export function pickOutcomeChannel(o: {
  phone: string | null;
  lineType: string | null;
  email: string | null;
  emailOk: boolean;
}): "sms" | "email" | null {
  if (o.phone && isTextableLineType(o.lineType)) return "sms";
  if (o.email && o.emailOk) return "email";
  return null;
}

export type OutcomeRunSummary = { scanned: number; sent: number; skipped: number; log: string[] };

/** Find week-old unlocks that never got their check-in and send it on the
 *  buyer's best channel. One per unlock ever (kind+ref dedupe across BOTH
 *  send logs), one per buyer per run. */
export async function runOutcomeChecks(opts?: { limit?: number; apply?: boolean }): Promise<OutcomeRunSummary> {
  const limit = Math.min(opts?.limit ?? OUTCOME_MAX_PER_RUN, 200);
  const apply = opts?.apply ?? false;
  const log: string[] = [];
  const now = Date.now();

  const [unlocks, emailChecked, smsChecked] = await Promise.all([
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
    db
      .select({ ref_id: smsSend.ref_id })
      .from(smsSend)
      .where(and(eq(smsSend.kind, KIND), isNotNull(smsSend.ref_id))),
  ]);
  const checked = new Set([
    ...emailChecked.map((r) => r.ref_id),
    ...smsChecked.map((r) => r.ref_id),
  ]);

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
    if (!b) {
      skipped++;
      continue;
    }
    // The prospect-company link carries the SMS identity: the screened phone
    // plus the company_key that attributes their reply back to the AI thread.
    const [pc] = await db
      .select({
        key: prospectCompany.key,
        phone: prospectCompany.phone,
        line_type: prospectCompany.line_type,
        lat: prospectCompany.office_lat,
        lng: prospectCompany.office_lng,
      })
      .from(prospectCompany)
      .where(eq(prospectCompany.buyer_id, u.buyer_id))
      .limit(1);
    const emailOk = !!b.notify && !isPlaceholderEmail(b.email);
    const channel = pickOutcomeChannel({
      phone: pc?.phone ?? null,
      lineType: pc?.line_type ?? null,
      email: b.email,
      emailOk,
    });
    if (!channel) {
      skipped++;
      continue;
    }
    const [prop] = await db
      .select({ city: property.city })
      .from(property)
      .where(eq(property.id, u.property_id))
      .limit(1);

    if (channel === "sms") {
      // Same guardrails as every outbound text: recipient-local business
      // hours and the shared daily cap ledger (opt-outs are enforced inside
      // sendSms). Blocked → try again next cron run, don't downgrade a
      // texting relationship to email over a timing miss.
      if (!withinSmsSendWindow(new Date(now), marketTz(pc!.lat, pc!.lng))) {
        skipped++;
        log.push(`  … ${b.company_name} — SMS window closed, next run`);
        continue;
      }
      const text = outcomeSmsFor({ city: prop?.city ?? null, trade: u.trade });
      buyersThisRun.add(u.buyer_id);
      if (!apply) {
        sent++;
        log.push(`  DRY sms ${b.company_name} ${pc!.phone} — "${text.split("\n")[0]}"`);
        continue;
      }
      if (!(await rateLimit("smsqueue:day", TEXT_QUEUE_DAILY_CAP(), 86_400)).ok) {
        skipped++;
        log.push(`  … ${b.company_name} — daily SMS cap reached, next run`);
        continue;
      }
      const res = await sendSms({
        to: pc!.phone!,
        body: text,
        kind: KIND,
        companyKey: pc!.key,
        buyerId: b.id,
        refId: u.id,
      });
      if (res.ok) {
        sent++;
        log.push(`  ✓ sms ${b.company_name} — outcome check sent`);
      } else {
        skipped++;
        log.push(`  ✗ sms ${b.company_name} — ${res.error}`);
      }
      continue;
    }

    const msg = buildOutcomeMessage({
      company: b.company_name,
      city: prop?.city ?? null,
      trade: u.trade,
      brand,
    });
    buyersThisRun.add(u.buyer_id);
    if (!apply) {
      sent++;
      log.push(`  DRY email ${b.company_name} <${b.email}> — "${msg.subject}"`);
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
      log.push(`  ✓ email ${b.company_name} <${b.email}> — outcome check sent`);
    } else {
      skipped++;
      log.push(`  ✗ email ${b.company_name} — send failed (${res.error})`);
    }
  }

  if (!apply && sent) log.push(`DRY RUN — ${sent} outcome check(s) would send; pass ?apply=1.`);
  return { scanned: unlocks.length, sent, skipped, log };
}
