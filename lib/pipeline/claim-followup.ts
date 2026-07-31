// The offer-viewed follow-up.
//
// Opening the claim page is the strongest unconverted signal we have: they read
// the actual offer and stopped. Until now that produced a ranking-score bump
// (lib/sms/queue.ts) and a filter for last-spot alerts (lib/leads/scarcity.ts)
// and nothing else — nobody was told, and nothing followed up. On 2026-07-31
// there were eight such companies sitting untouched, three of them having
// viewed twice.
//
// TONE. This must not read as surveillance. "I saw you clicked the link" is
// creepy and torches the trust the offer was built to earn. The message names
// the JOB, not the tracking: the lead is still open, is there anything to
// answer. That is true, useful, and reveals nothing about what we watch.
//
// TIMING. A floor of a couple of hours so we never interrupt someone who is
// mid-form, and a ceiling of a week because after that the specific job is
// stale and it reads as a cold pitch instead of a follow-up.
//
// Once ever per company, enforced by kind+ref_id in sms_send/email_send — the
// same ledger pattern hold-expiry uses. A second "still interested?" is nagging.

import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db";
import { buyerOutreach, emailSend, property, prospectCompany, smsOptOut, smsSend, suppression } from "../db/schema";
import { sendSms, toE164 } from "../integrations/twilio";
import { sendEmail } from "../integrations/resend";
import { loadUndeliverable } from "../sms/undeliverable";
import { withinSmsSendWindow } from "../sms/queue";
import { pickOutcomeChannel } from "./outcome-check";
import { TRADES, asTrade } from "../leads/trades";
import { leadAvailability } from "../leads/availability";
import { marketTz } from "../markets";
import { getDefaultCompany } from "../db/queries";
import { signBuyerUnsub } from "../buyer-auth";
import { siteBase, toHtml } from "./buyer-prospecting";

const KIND = "claim_followup";

/** Don't interrupt someone who may still be filling the form. */
export const FOLLOWUP_MIN_HOURS = Number(process.env.CLAIM_FOLLOWUP_MIN_HOURS) || 3;
/** After this the specific job is stale and it reads as a cold pitch. */
export const FOLLOWUP_MAX_DAYS = Number(process.env.CLAIM_FOLLOWUP_MAX_DAYS) || 7;
export const FOLLOWUP_MAX_PER_RUN = 25;

export type ClaimViewer = {
  key: string;
  name: string;
  trade: string;
  city: string | null;
  lastViewAt: Date | null;
  converted: boolean;
  blocked: boolean;
  alreadyFollowedUp: boolean;
};

/**
 * PURE. Who is due an offer-viewed follow-up right now.
 *
 * Deliberately narrow. A company qualifies only if it actually READ the offer
 * and did not act — not merely opened an email, which the nudge already covers.
 * Converted accounts are excluded because they are customers now, and a
 * "still interested?" to someone who already bought is embarrassing.
 */
export function selectClaimFollowUps(
  rows: ClaimViewer[],
  now: Date
): ClaimViewer[] {
  const floor = now.getTime() - FOLLOWUP_MIN_HOURS * 3_600_000;
  const ceiling = now.getTime() - FOLLOWUP_MAX_DAYS * 86_400_000;
  return rows
    .filter((r) => {
      if (r.converted || r.blocked || r.alreadyFollowedUp) return false;
      const t = r.lastViewAt?.getTime();
      if (t == null) return false;
      return t <= floor && t >= ceiling;
    })
    // Longest-waiting first: the person who read it three days ago is closest
    // to forgetting us entirely.
    .sort((a, b) => (a.lastViewAt?.getTime() ?? 0) - (b.lastViewAt?.getTime() ?? 0))
    .slice(0, FOLLOWUP_MAX_PER_RUN);
}

/** PURE. The text. Names the job, never the tracking. */
export function followUpSms(o: { city: string | null; trade: string }): string {
  const service = TRADES[asTrade(o.trade)].service;
  const where = o.city ? `${o.city} ` : "";
  return (
    `Cole with Greenkeep — that ${where}${service} job is still open if you want it. ` +
    `Anything I can answer about it?`
  );
}

/** PURE. Same message, email shape. */
export function followUpEmail(o: {
  company: string;
  city: string | null;
  trade: string;
  brand: string;
}): { subject: string; body: string } {
  const service = TRADES[asTrade(o.trade)].service;
  const where = o.city ? `${o.city} ` : "";
  return {
    subject: `That ${where}${service} job is still open`,
    body: `${o.company} team —

The ${where}${service} job we sent over is still open. It's free to claim and takes about a minute — no card.

If something about it didn't fit, tell me what you're actually looking for and I'll watch for it.

— ${o.brand}`,
  };
}

export type ClaimFollowUpSummary = {
  scanned: number;
  due: number;
  texted: number;
  emailed: number;
  skipped: number;
  log: string[];
};

export async function runClaimFollowUps(opts?: { apply?: boolean }): Promise<ClaimFollowUpSummary> {
  const apply = opts?.apply ?? false;
  const now = new Date();
  const log: string[] = [];

  const [rows, smsDone, emailDone, optOuts, suppressed, undeliverable] = await Promise.all([
    db
      .select({
        key: prospectCompany.key,
        name: prospectCompany.name,
        trade: prospectCompany.trade,
        city: prospectCompany.office_city,
        phone: prospectCompany.phone,
        email: prospectCompany.email,
        line_type: prospectCompany.line_type,
        lat: prospectCompany.office_lat,
        lng: prospectCompany.office_lng,
        claim_views: prospectCompany.claim_views,
        last_claim_view_at: prospectCompany.last_claim_view_at,
        buyer_id: prospectCompany.buyer_id,
        blocked_at: prospectCompany.blocked_at,
      })
      .from(prospectCompany)
      .where(and(isNotNull(prospectCompany.last_claim_view_at), isNull(prospectCompany.buyer_id))),
    db.select({ ref_id: smsSend.ref_id }).from(smsSend).where(eq(smsSend.kind, KIND)),
    db.select({ ref_id: emailSend.ref_id }).from(emailSend).where(eq(emailSend.kind, KIND)),
    db.select({ phone: smsOptOut.phone }).from(smsOptOut),
    db.select({ email: suppression.email }).from(suppression),
    loadUndeliverable(),
  ]);

  const done = new Set<string>([
    ...smsDone.map((r) => r.ref_id).filter(Boolean),
    ...emailDone.map((r) => r.ref_id).filter(Boolean),
  ] as string[]);
  const optedOut = new Set(optOuts.map((o) => o.phone));
  const suppressedSet = new Set(suppressed.map((s) => s.email.toLowerCase()));

  const due = selectClaimFollowUps(
    rows.map((r) => ({
      key: r.key,
      name: r.name,
      trade: r.trade,
      city: r.city,
      lastViewAt: r.last_claim_view_at,
      converted: !!r.buyer_id,
      blocked: !!r.blocked_at,
      alreadyFollowedUp: done.has(r.key),
    })),
    now
  );

  const co = await getDefaultCompany();
  const brand = co?.name ?? "Greenkeep";
  const byKey = new Map(rows.map((r) => [r.key, r]));
  let texted = 0;
  let emailed = 0;
  let skipped = 0;

  for (const d of due) {
    const r = byKey.get(d.key);
    if (!r) continue;

    // The message says the job is STILL OPEN. Verify that before asserting it.
    // Their last offer may have sold to its cap or been pulled since they
    // looked, and telling a prospect a closed job is open is a lie that costs
    // exactly the trust this follow-up exists to rebuild. A company whose lead
    // has closed is not abandoned — long_tail re-touches them with fresh
    // inventory, which is the honest version of the same nudge.
    const [lastOffer] = await db
      .select({ property_id: buyerOutreach.property_id })
      .from(buyerOutreach)
      .where(and(eq(buyerOutreach.company_key, r.key), isNotNull(buyerOutreach.property_id)))
      .orderBy(desc(buyerOutreach.sent_at))
      .limit(1);
    if (!lastOffer?.property_id) {
      skipped++;
      log.push(`  … ${r.name} — no identifiable offer to reference`);
      continue;
    }
    const [prop] = await db
      .select()
      .from(property)
      .where(eq(property.id, lastOffer.property_id))
      .limit(1);
    if (!prop) {
      skipped++;
      log.push(`  … ${r.name} — offered property is gone`);
      continue;
    }
    const avail = await leadAvailability(prop, asTrade(r.trade));
    if (!avail.open) {
      skipped++;
      log.push(`  … ${r.name} — that job has closed, not claiming otherwise`);
      continue;
    }

    const cell = toE164(r.phone);
    const addr = r.email?.toLowerCase() ?? null;
    const channel = pickOutcomeChannel({
      phone: cell && !optedOut.has(cell) ? cell : null,
      lineType: r.line_type,
      email: addr,
      emailOk: !!addr && !suppressedSet.has(addr),
      smsOk: !cell || !undeliverable.has(cell),
    });
    if (!channel) {
      skipped++;
      log.push(`  … ${r.name} — no reachable channel`);
      continue;
    }

    if (channel === "sms") {
      if (!withinSmsSendWindow(now, marketTz(r.lat, r.lng))) {
        skipped++;
        log.push(`  … ${r.name} — SMS window closed`);
        continue;
      }
      const text = followUpSms({ city: r.city, trade: r.trade });
      if (!apply) {
        log.push(`  DRY sms ${r.name} — "${text.slice(0, 70)}…"`);
        continue;
      }
      const res = await sendSms({ to: cell!, body: text, kind: KIND, companyKey: r.key, refId: r.key });
      if (res.ok) {
        texted++;
        log.push(`  ✓ texted ${r.name}`);
      } else {
        skipped++;
        log.push(`  × ${r.name} — ${res.error}`);
      }
      continue;
    }

    const { subject, body } = followUpEmail({ company: r.name, city: r.city, trade: r.trade, brand });
    if (!apply) {
      log.push(`  DRY email ${r.name} — "${subject}"`);
      continue;
    }
    const unsubUrl = `${siteBase()}/api/unsubscribe?t=${signBuyerUnsub(addr!)}`;
    const res = await sendEmail({
      to: addr!,
      subject,
      html: toHtml(body, unsubUrl, co?.physical_mailing_address ?? null),
      text: `${body}\n\nUnsubscribe: ${unsubUrl}`,
      // Cold-adjacent: they were pitched, never bought. Route it through the
      // campaign domain so a complaint can't touch transactional reputation.
      stream: "campaign",
      tags: { kind: KIND },
      logAs: { kind: KIND, refId: r.key },
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (res.ok) {
      emailed++;
      log.push(`  ✓ emailed ${r.name}`);
    } else {
      skipped++;
      log.push(`  × ${r.name} — ${res.error}`);
    }
  }

  return { scanned: rows.length, due: due.length, texted, emailed, skipped, log };
}
