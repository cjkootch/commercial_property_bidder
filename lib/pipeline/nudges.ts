// The 48h nudge: launch analysis showed engaged-but-unconverted companies are
// the hottest pool we have (openers/clickers who never claimed), and nobody
// was following up. One short reminder per outreach row, ever: engaged
// (opened or clicked), 48h+ old, not converted, lead still open. Same
// compliance rails as every send — suppression-checked, one-click unsubscribe.

import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "../db";
import { buyerOutreach, company, property, prospectCompany, suppression } from "../db/schema";
import { sendEmail } from "../integrations/resend";
import { signBuyerUnsub } from "../buyer-auth";
import { leadAvailability, leadMaxBuyers } from "../leads/availability";
import { TRADES, asTrade, type Trade } from "../leads/trades";
import { siteBase, toHtml } from "./buyer-prospecting";

/** How long an engaged offer sits before the (single) follow-up. */
export const NUDGE_AFTER_HOURS = 48;
/** Claim tokens expire at 30 days — never nudge a link that's about to be
 *  (or already is) dead. 25d leaves margin for send + read time. */
export const NUDGE_MAX_AGE_DAYS = 25;
/** Safety cap per run. */
export const NUDGE_MAX_PER_RUN = 50;

export type NudgeCandidateRow = {
  id: string;
  company_key: string;
  company_name: string;
  email: string | null;
  property_id: string | null;
  claim_url: string | null;
  sent_at: Date | null;
  opened_at: Date | null;
  clicked_at: Date | null;
  nudged_at: Date | null;
};

/** Pure selector: which rows earn the one follow-up. One per company per run
 *  (the most recently engaged row wins) so a company on three campaigns gets
 *  one email, not three. */
export function selectNudgeTargets(
  rows: NudgeCandidateRow[],
  opts: { now: Date; convertedKeys: Set<string>; suppressed: Set<string> }
): NudgeCandidateRow[] {
  const cutoff = opts.now.getTime() - NUDGE_AFTER_HOURS * 3600_000;
  const oldest = opts.now.getTime() - NUDGE_MAX_AGE_DAYS * 86400_000;
  const eligible = rows.filter(
    (r) =>
      r.email &&
      r.property_id &&
      r.claim_url &&
      !r.nudged_at &&
      (r.opened_at || r.clicked_at) &&
      r.sent_at &&
      r.sent_at.getTime() <= cutoff &&
      r.sent_at.getTime() >= oldest && // claim token still has life in it
      !opts.convertedKeys.has(r.company_key) &&
      !opts.suppressed.has(r.email.toLowerCase())
  );
  const byCompany = new Map<string, NudgeCandidateRow>();
  for (const r of eligible) {
    const engaged = (x: NudgeCandidateRow) =>
      Math.max(x.clicked_at?.getTime() ?? 0, x.opened_at?.getTime() ?? 0);
    const prev = byCompany.get(r.company_key);
    if (!prev || engaged(r) > engaged(prev)) byCompany.set(r.company_key, r);
  }
  return [...byCompany.values()];
}

/** The follow-up itself: short, references the offer they read, restates the
 *  scarcity honestly (live spots-left), same claim link. */
export function buildNudgeMessage(o: {
  company: string;
  trade: Trade;
  city: string | null;
  spotsLeft: number;
  cap: number;
  claimUrl: string;
  brand: string;
  replyEmail: string;
}): { subject: string; body: string } {
  const service = o.trade === "landscaping" ? "grounds" : TRADES[o.trade].service;
  const subject = `Still open — the ${service} lead${o.city ? ` in ${o.city}` : " near you"}`;
  const body = `${o.company} team —

Quick follow-up on the commercial ${service} lead we sent you${o.city ? ` in ${o.city}` : ""}: it's still open, and it's down to ${o.spotsLeft} of ${o.cap} spots. Once those go, the job closes for good.

The full sheet — exact address, owner and mailing address, our research, a ready-to-send intro letter — is one click:

${o.claimUrl}
(30 seconds, no card)

If it's not a fit, reply with your service area and we'll send the next match instead. This is the only reminder we'll send about this one.

— ${o.brand}
${o.replyEmail}`;
  return { subject, body };
}

export type NudgeRunSummary = {
  scanned: number;
  eligible: number;
  sent: number;
  skipped: number;
  log: string[];
};

/** Find engaged-but-unclaimed offers past the window and send the one
 *  follow-up each has earned. Dry-run by default. */
export async function runNudges(opts?: { limit?: number; apply?: boolean }): Promise<NudgeRunSummary> {
  const limit = Math.min(opts?.limit ?? NUDGE_MAX_PER_RUN, 200);
  const apply = opts?.apply ?? false;
  const log: string[] = [];

  const rows = (await db
    .select()
    .from(buyerOutreach)
    .where(
      and(
        eq(buyerOutreach.status, "sent"),
        isNull(buyerOutreach.nudged_at),
        isNotNull(buyerOutreach.email),
        or(isNotNull(buyerOutreach.opened_at), isNotNull(buyerOutreach.clicked_at))
      )
    )) as NudgeCandidateRow[];

  const convertedKeys = new Set(
    (
      await db
        .select({ key: prospectCompany.key })
        .from(prospectCompany)
        .where(isNotNull(prospectCompany.buyer_id))
    ).map((r) => r.key)
  );
  const suppressed = new Set(
    (await db.select({ email: suppression.email }).from(suppression)).map((r) =>
      r.email.toLowerCase()
    )
  );

  const targets = selectNudgeTargets(rows, { now: new Date(), convertedKeys, suppressed }).slice(
    0,
    limit
  );

  const [co] = await db.select().from(company).limit(1);
  const replyEmail = co?.email?.trim() || "";
  const cap = leadMaxBuyers();
  const base = siteBase();
  let sent = 0;
  let skipped = 0;

  for (const t of targets) {
    const trade = asTrade(t.claim_url?.match(/[?&]trade=([a-z]+)/)?.[1]);
    const [prop] = await db.select().from(property).where(eq(property.id, t.property_id!)).limit(1);
    if (!prop) {
      skipped++;
      continue;
    }
    // Only nudge toward a lead that can still be claimed — a follow-up to a
    // closed job would be pure noise (and dishonest about "spots left").
    const avail = await leadAvailability(prop, trade);
    if (!avail.open) {
      skipped++;
      log.push(`  ⊘ ${t.company_name} — lead closed (${trade}), no nudge`);
      continue;
    }
    const msg = buildNudgeMessage({
      company: t.company_name,
      trade,
      city: prop.city,
      spotsLeft: avail.spotsLeft,
      cap,
      claimUrl: t.claim_url!,
      brand: co?.name ?? "Greenkeep",
      replyEmail,
    });
    if (!apply) {
      sent++;
      log.push(`  DRY ${t.company_name} <${t.email}> — "${msg.subject}"`);
      continue;
    }
    // ATOMIC CLAIM before the send: a concurrent run (daily cron + manual
    // ?apply=1) selecting the same row must not both email — the conditional
    // UPDATE is the lock ("one reminder, ever" is promised in the email body).
    const claimed = await db
      .update(buyerOutreach)
      .set({ nudged_at: new Date(), updated_at: new Date() })
      .where(and(eq(buyerOutreach.id, t.id), isNull(buyerOutreach.nudged_at)))
      .returning({ id: buyerOutreach.id });
    if (claimed.length === 0) {
      skipped++;
      continue; // another run got there first
    }
    const unsubUrl = `${base}/api/unsubscribe?token=${encodeURIComponent(signBuyerUnsub(t.email!))}`;
    const res = await sendEmail({
      to: t.email!,
      subject: msg.subject,
      html: toHtml(msg.body, unsubUrl, co?.physical_mailing_address ?? null),
      replyTo: replyEmail || undefined,
      stream: "campaign", // cold follow-up — isolate from transactional domain reputation
      tags: { kind: "buyer_nudge" },
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (res.ok) {
      sent++;
      // Store the step's OWN message id so the Resend webhook can attribute
      // the follow-up's opens/clicks (sequence-step reporting on /campaigns).
      await db
        .update(buyerOutreach)
        .set({ nudge_message_id: res.id, updated_at: new Date() })
        .where(eq(buyerOutreach.id, t.id));
      log.push(`  ✓ ${t.company_name} <${t.email}> — nudged`);
    } else {
      // Send failed after the claim — release it so a later run retries.
      await db
        .update(buyerOutreach)
        .set({ nudged_at: null, updated_at: new Date() })
        .where(eq(buyerOutreach.id, t.id));
      skipped++;
      log.push(`  ✗ ${t.company_name} — send failed (${res.error})`);
    }
  }

  if (!apply && sent) log.push(`DRY RUN — ${sent} nudge(s) would send; pass ?apply=1 to send.`);
  return { scanned: rows.length, eligible: targets.length, sent, skipped, log };
}
