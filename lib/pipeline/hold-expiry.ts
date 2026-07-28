// The warning shot before the take-away. The 24h hold places loss aversion's
// setup ("the free spot is yours") but until now the deadline passed in
// silence — no almost-losing moment, which is where the mechanic actually
// converts (Godin: people feel the loss, not the offer). So: ONE reminder per
// hold, a few hours before it expires, on the company's best channel, with a
// fresh claim link. Holds are released on claim and lazily deleted on expiry,
// so a live row in the lookahead window is by definition still claimable.

import { and, eq, gt, isNotNull, lte, notInArray } from "drizzle-orm";
import { db } from "../db";
import { emailSend, leadHold, property, prospectCompany, smsSend } from "../db/schema";
import { sendEmail } from "../integrations/resend";
import { sendSms, toE164 } from "../integrations/twilio";
import { getDefaultCompany } from "../db/queries";
import { marketTz } from "../markets";
import { rateLimit } from "../ratelimit";
import { TRADES, asTrade } from "../leads/trades";
import { freshClaimUrl, TEXT_QUEUE_DAILY_CAP, withinSmsSendWindow } from "../sms/queue";
import { signBuyerUnsub } from "../buyer-auth";
import { siteBase, toHtml } from "./buyer-prospecting";
import { pickOutcomeChannel } from "./outcome-check";
import { loadUndeliverable } from "../sms/undeliverable";

/** How close to expiry the reminder fires. Wide enough that an hourly cron
 *  inside the send window always gets a shot at a 24h hold. */
export const HOLD_REMIND_BEFORE_HOURS = Number(process.env.HOLD_REMIND_BEFORE_HOURS) || 5;
/** Under this there's no meaningful time left to act — let it lapse. */
export const HOLD_REMIND_MIN_MINUTES = 15;
export const HOLD_REMIND_MAX_PER_RUN = 25;

const KIND = "hold_expiry";

/** "5:11 PM" in the recipient's own timezone — the deadline has to read as
 *  their clock, not UTC. */
export function localClock(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(at);
}

export function holdReminderSmsFor(o: {
  city: string | null;
  trade: string;
  expiresAt: Date;
  tz: string;
  claimUrl: string;
}): string {
  const service = TRADES[asTrade(o.trade)].service;
  const where = o.city ? `${o.city} ` : "";
  return (
    `Heads up — your hold on the ${where}${service} job ends at ${localClock(o.expiresAt, o.tz)}. ` +
    `After that it opens back up to the next company. Claiming takes about a minute: ${o.claimUrl}\n-Cole`
  );
}

export function buildHoldReminderEmail(o: {
  company: string;
  city: string | null;
  trade: string;
  expiresAt: Date;
  tz: string;
  claimUrl: string;
  brand: string;
}): { subject: string; body: string } {
  const service = TRADES[asTrade(o.trade)].service;
  const where = o.city ? `${o.city} ` : "";
  const clock = localClock(o.expiresAt, o.tz);
  const subject = `Your hold on the ${where}${service} job ends at ${clock}`;
  const body = `${o.company} team —

The free spot on the ${where}${service} job is still held for you, but the hold ends at ${clock}. After that it opens back up to the next company in line.

Claiming takes about a minute — no charge, no card:

${o.claimUrl}

— ${o.brand}`;
  return { subject, body };
}

export type ExpiringHold = { id: string; expires_at: Date };

/** Pure eligibility: live, inside the lookahead, not already reminded, and
 *  with enough runway left to act. */
export function selectExpiringHolds<T extends ExpiringHold>(
  holds: T[],
  reminded: Set<string | null>,
  now: Date
): T[] {
  const from = now.getTime() + HOLD_REMIND_MIN_MINUTES * 60_000;
  const to = now.getTime() + HOLD_REMIND_BEFORE_HOURS * 3_600_000;
  return holds.filter((h) => {
    const t = h.expires_at.getTime();
    return t > from && t <= to && !reminded.has(h.id);
  });
}

export type HoldExpiryRunSummary = {
  scanned: number;
  sent: number;
  skipped: number;
  log: string[];
};

export async function runHoldExpiryReminders(opts?: { apply?: boolean }): Promise<HoldExpiryRunSummary> {
  const apply = opts?.apply ?? false;
  const log: string[] = [];
  const now = new Date();

  const [holds, smsReminded, emailReminded, undeliverable] = await Promise.all([
    db
      .select({
        id: leadHold.id,
        property_id: leadHold.property_id,
        trade: leadHold.trade,
        company: leadHold.company,
        expires_at: leadHold.expires_at,
      })
      .from(leadHold)
      .where(
        and(
          gt(leadHold.expires_at, now),
          lte(leadHold.expires_at, new Date(now.getTime() + HOLD_REMIND_BEFORE_HOURS * 3_600_000))
        )
      ),
    // A carrier-rejected reminder did NOT remind anyone — only sends that
    // weren't hard-failed count (first live run: Monarch's landline bounce
    // stamped the hold "reminded" and blocked the email fallback forever).
    db
      .select({ ref_id: smsSend.ref_id })
      .from(smsSend)
      .where(
        and(
          eq(smsSend.kind, KIND),
          isNotNull(smsSend.ref_id),
          notInArray(smsSend.status, ["undelivered", "failed"])
        )
      ),
    db.select({ ref_id: emailSend.ref_id }).from(emailSend).where(eq(emailSend.kind, KIND)),
    loadUndeliverable(),
  ]);
  const reminded = new Set([...smsReminded.map((r) => r.ref_id), ...emailReminded.map((r) => r.ref_id)]);
  const due = selectExpiringHolds(holds, reminded, now).slice(0, HOLD_REMIND_MAX_PER_RUN);

  const co = await getDefaultCompany();
  const brand = co?.name ?? "Greenkeep";
  let sent = 0;
  let skipped = 0;

  for (const h of due) {
    // The hold stores companyKey; the prospect profile carries the reachable
    // identity (screened phone, email, display name for the claim token).
    const [pc] = await db
      .select({
        key: prospectCompany.key,
        name: prospectCompany.name,
        phone: prospectCompany.phone,
        line_type: prospectCompany.line_type,
        email: prospectCompany.email,
        lat: prospectCompany.office_lat,
        lng: prospectCompany.office_lng,
      })
      .from(prospectCompany)
      .where(eq(prospectCompany.key, h.company))
      .limit(1);
    if (!pc) {
      skipped++;
      log.push(`  … ${h.company} — no prospect profile, unreachable`);
      continue;
    }
    // Normalize BEFORE picking: a junk phone ("1.8571428571" — sourcing
    // artifact, first live run) must route to email, not to a doomed SMS.
    const cell = toE164(pc.phone);
    const channel = pickOutcomeChannel({
      phone: cell,
      lineType: pc.line_type,
      email: pc.email,
      emailOk: !!pc.email, // suppression enforced centrally in sendEmail
      // Carrier already rejected this number — route to email instead of
      // spending another send on it.
      smsOk: !cell || !undeliverable.has(cell),
    });
    if (!channel) {
      skipped++;
      log.push(`  … ${pc.name} — no reachable channel`);
      continue;
    }
    const [prop] = await db
      .select({ city: property.city })
      .from(property)
      .where(eq(property.id, h.property_id))
      .limit(1);
    const tz = marketTz(pc.lat, pc.lng);
    const claimUrl = freshClaimUrl(h.property_id, pc.name, h.trade);

    if (channel === "sms") {
      if (!withinSmsSendWindow(now, tz)) {
        skipped++;
        log.push(`  … ${pc.name} — SMS window closed`);
        continue;
      }
      const text = holdReminderSmsFor({
        city: prop?.city ?? null,
        trade: h.trade,
        expiresAt: h.expires_at,
        tz,
        claimUrl,
      });
      if (!apply) {
        sent++;
        log.push(`  DRY sms ${pc.name} ${pc.phone} — "${text.split("\n")[0].slice(0, 80)}…"`);
        continue;
      }
      if (!(await rateLimit("smsqueue:day", TEXT_QUEUE_DAILY_CAP(), 86_400)).ok) {
        skipped++;
        log.push(`  … ${pc.name} — daily SMS cap reached`);
        continue;
      }
      const res = await sendSms({ to: cell!, body: text, kind: KIND, companyKey: pc.key, refId: h.id });
      if (res.ok) {
        sent++;
        log.push(`  ✓ sms ${pc.name} — hold reminder sent`);
        continue;
      }
      log.push(`  ✗ sms ${pc.name} — ${res.error}${pc.email ? " — falling back to email" : ""}`);
      if (!pc.email) {
        skipped++;
        continue;
      }
      // fall through to the email path below
    }

    const msg = buildHoldReminderEmail({
      company: pc.name,
      city: prop?.city ?? null,
      trade: h.trade,
      expiresAt: h.expires_at,
      tz,
      claimUrl,
      brand,
    });
    if (!apply) {
      sent++;
      log.push(`  DRY email ${pc.name} <${pc.email}> — "${msg.subject}"`);
      continue;
    }
    const unsubUrl = `${siteBase()}/api/unsubscribe?token=${encodeURIComponent(signBuyerUnsub(pc.email!))}`;
    const res = await sendEmail({
      to: pc.email!,
      subject: msg.subject,
      html: toHtml(msg.body, unsubUrl, co?.physical_mailing_address ?? null),
      text: `${msg.body}\n\nUnsubscribe: ${unsubUrl}`,
      stream: "campaign",
      tags: { kind: KIND },
      logAs: { kind: KIND, refId: h.id },
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (res.ok) {
      sent++;
      log.push(`  ✓ email ${pc.name} — hold reminder sent`);
    } else {
      skipped++;
      log.push(`  ✗ email ${pc.name} — ${res.error}`);
    }
  }

  if (!apply && sent) log.push(`DRY RUN — ${sent} reminder(s) would send; pass ?apply=1.`);
  return { scanned: holds.length, sent, skipped, log };
}
