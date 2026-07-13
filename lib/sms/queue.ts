// The text queue: suggested first-touch SMS for hot, phone-eligible
// prospects. NOTHING here sends — the operator reviews each suggestion and
// taps Send one at a time (human-initiated, one-to-one; the compliance
// posture in docs/instrumentation.md). The script is the operator's two-step:
// a short human opener, then — once they reply — the pitch with their claim
// link, where Greenkeep is identified and the casual opt-out is offered.

import { isNotNull, isNull, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyerOutreach, prospectCompany, smsOptOut, smsSend } from "@/lib/db/schema";
import { toE164, isTextableLineType } from "@/lib/integrations/twilio";
import { signBuyerClaim } from "@/lib/buyer-auth";
import { DEFAULT_TZ, marketTimezones } from "@/lib/markets";

/** Claim links for texts are minted FRESH at suggestion/send time — a stored
 *  buyer_outreach.claim_url may be older than the 30-day token TTL, and a
 *  dead link in a text is worse than no text (2026-07-12 audit). */
export function freshClaimUrl(propertyId: string, company: string, trade: string | null): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://greenkeep.us").replace(/\/$/, "");
  return `${base}/buyers/claim/${signBuyerClaim(propertyId, company)}?trade=${trade || "landscaping"}`;
}

export const TEXT_QUEUE_DAILY_CAP = () => {
  const n = Number(process.env.TEXT_QUEUE_DAILY_CAP);
  return Number.isFinite(n) && n > 0 ? n : 200;
};

/** Automated sends only go out when a human plausibly would: weekdays,
 *  9am–6pm on the RECIPIENT's local wall clock. Enforced in the cron route
 *  itself so an edited cron schedule can never text someone at 3am. Pass the
 *  recipient's market timezone (`marketTz(lat,lng)`); default Central keeps the
 *  original Texas behavior for callers without a per-recipient tz. */
export function withinSmsSendWindow(now: Date, tz: string = DEFAULT_TZ): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const day = parts.find((p) => p.type === "weekday")?.value ?? "";
  const weekday = !["Sat", "Sun"].includes(day);
  return weekday && hour >= 9 && hour < 18;
}

/** Coarse gate for a run serving multiple metros: open if ANY market's local
 *  clock is inside the send window. The precise call is per-recipient, on that
 *  recipient's own market timezone. */
export function anySmsSendWindowOpen(now: Date): boolean {
  return marketTimezones().some((tz) => withinSmsSendWindow(now, tz));
}

export function openerFor(name: string, city: string | null): string {
  return `Hi, is this ${name}${city ? ` in ${city}` : ""}?\n\nThanks,\n-Cole`;
}

/** The casual opt-out line — used once per conversation, in step 2. Twilio
 *  still honors a literal STOP reply automatically regardless of wording. */
export const OPT_OUT_LINE = "Just let me know if you're not interested.";

/** Step 2 — sent manually from the thread after they reply. Identifies the
 *  business (CTIA sender-ID) and carries the one-time opt-out line. */
export function step2For(name: string, claimUrl: string): string {
  return (
    `Great — I found a local opportunity that looks like a good fit for ${name}. ` +
    `Here it is, no charge: ${claimUrl}\n\n` +
    `We tell you who to reach out to, when, and why they're likely to become ` +
    `your next customer. If it's useful, happy to send more. ${OPT_OUT_LINE}\n\n` +
    `-Cole, Greenkeep`
  );
}

export type QueueSuggestion = {
  companyId: string;
  companyKey: string;
  name: string;
  city: string | null;
  phone: string; // E.164
  score: number;
  claimViews: number;
  opens: number;
  clicks: number;
  hasEmail: boolean;
  lineType: string | null; // cached Twilio line type; null = not yet screened
  opener: string;
  claimUrl: string;
};

/** Rank first-touch candidates: engaged with email (or unreachable BY email),
 *  phone on file, never texted, not opted out/blocked/converted, and holding
 *  a live claim link for step 2 to deliver. */
export async function suggestedTexts(limit: number): Promise<QueueSuggestion[]> {
  const [companies, outreach, texted, optOuts] = await Promise.all([
    db
      .select({
        id: prospectCompany.id,
        key: prospectCompany.key,
        name: prospectCompany.name,
        phone: prospectCompany.phone,
        email: prospectCompany.email,
        office_city: prospectCompany.office_city,
        claim_views: prospectCompany.claim_views,
        trade: prospectCompany.trade,
        line_type: prospectCompany.line_type,
      })
      .from(prospectCompany)
      .where(
        and(
          isNotNull(prospectCompany.phone),
          isNull(prospectCompany.blocked_at),
          isNull(prospectCompany.buyer_id)
        )
      ),
    db
      .select({
        company_key: buyerOutreach.company_key,
        claim_url: buyerOutreach.claim_url,
        property_id: buyerOutreach.property_id,
        sent_at: buyerOutreach.sent_at,
        opened_at: buyerOutreach.opened_at,
        clicked_at: buyerOutreach.clicked_at,
        nudge_opened_at: buyerOutreach.nudge_opened_at,
        nudge_clicked_at: buyerOutreach.nudge_clicked_at,
      })
      .from(buyerOutreach)
      .where(isNotNull(buyerOutreach.sent_at)),
    db.select({ phone: smsSend.phone }).from(smsSend),
    db.select({ phone: smsOptOut.phone }).from(smsOptOut),
  ]);

  const alreadyTexted = new Set(texted.map((t) => t.phone));
  const optedOut = new Set(optOuts.map((o) => o.phone));

  type Agg = { opens: number; clicks: number; propertyId: string | null; claimAt: number };
  const byKey = new Map<string, Agg>();
  for (const o of outreach) {
    const a = byKey.get(o.company_key) ?? { opens: 0, clicks: 0, propertyId: null, claimAt: 0 };
    if (o.opened_at || o.nudge_opened_at) a.opens++;
    if (o.clicked_at || o.nudge_clicked_at) a.clicks++;
    const at = o.sent_at?.getTime() ?? 0;
    if (o.claim_url && o.property_id && at >= a.claimAt) {
      a.propertyId = o.property_id;
      a.claimAt = at;
    }
    byKey.set(o.company_key, a);
  }

  const out: QueueSuggestion[] = [];
  for (const c of companies) {
    const phone = toE164(c.phone);
    if (!phone || alreadyTexted.has(phone) || optedOut.has(phone)) continue;
    // Known landlines are dropped up front; unscreened (null) numbers stay
    // candidates and get a just-in-time lookup at send time (fail-open).
    if (!isTextableLineType(c.line_type)) continue;
    const a = byKey.get(c.key);
    if (!a?.propertyId) continue; // step 2 needs a link to deliver
    // Heat: claim-page reads dominate, then clicks/opens; a missing email
    // adds weight because SMS is the only channel left for them.
    const score = c.claim_views * 5 + a.clicks * 3 + a.opens + (c.email ? 0 : 2);
    if (score < 1) continue; // cold-cold stays in the email machine
    out.push({
      companyId: c.id,
      companyKey: c.key,
      name: c.name,
      city: c.office_city,
      phone,
      score,
      claimViews: c.claim_views,
      opens: a.opens,
      clicks: a.clicks,
      hasEmail: !!c.email,
      lineType: c.line_type,
      opener: openerFor(c.name, c.office_city),
      claimUrl: freshClaimUrl(a.propertyId, c.name, c.trade),
    });
  }
  out.sort((a, b) => b.score - a.score);
  // Sister companies sharing one office line must not each earn an opener —
  // one phone, one first touch (highest score wins; sort above decides).
  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.phone) ? false : (seen.add(s.phone), true))).slice(0, limit);
}

/** Queue sends already made today (Chicago wall clock), for the daily cap.
 *  Openers and no-reply nudges share one budget — the cap bounds how many
 *  cold-ish texts leave the building per day, whatever step they are. */
export async function queueSentToday(): Promise<number> {
  const rows = await db
    .select({ kind: smsSend.kind, created_at: smsSend.created_at })
    .from(smsSend);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = fmt.format(new Date());
  return rows.filter(
    (r) =>
      (r.kind === "text_queue" || r.kind === "text_nudge") && fmt.format(r.created_at) === today
  ).length;
}

// --- the no-reply follow-up (SMS mirror of the email 48h nudge) -------------
// Email nudges the ENGAGED (opened but never claimed). SMS inverts: a reply
// already starts the AI conversation, so the gap is the SILENT — step 2 is
// reply-gated, meaning a prospect who ignores "Hi, is this X?" never hears
// the actual pitch. The nudge delivers step 2 anyway, once, then goes quiet.

/** How long an unanswered opener sits before the (single) follow-up. Same
 *  window as the email nudge (lib/pipeline/nudges.NUDGE_AFTER_HOURS). */
export const SMS_NUDGE_AFTER_HOURS = 48;
/** Claim tokens live 30 days — same margin rule as the email nudge. */
export const SMS_NUDGE_MAX_AGE_DAYS = 25;

/** The follow-up text: delivers the pitch + link the silent opener never
 *  earned, identifies the business (CTIA), carries the casual opt-out. */
export function nudgeTextFor(name: string, claimUrl: string): string {
  return (
    `Didn't hear back, so I'll just send it over — we found a commercial ` +
    `opportunity near you that looks like a fit for ${name}. Free to view: ${claimUrl}\n\n` +
    `${OPT_OUT_LINE}\n\n-Cole, Greenkeep`
  );
}

/** Pure selector (mirrors lib/pipeline/nudges.selectNudgeTargets): phones we
 *  opened with that never replied, never nudged, 48h–25d old, not opted out.
 *  Returns phone → opener time. */
export function selectSmsNudges(args: {
  now: Date;
  sends: Array<{ direction: string; kind: string; phone: string; created_at: Date; status?: string }>;
  optedOut: Set<string>;
}): Map<string, Date> {
  const cutoff = args.now.getTime() - SMS_NUDGE_AFTER_HOURS * 3600_000;
  const oldest = args.now.getTime() - SMS_NUDGE_MAX_AGE_DAYS * 86400_000;
  // Any inbound = they replied (the conversation path owns them now).
  // Any prior nudge = they had their one follow-up.
  // Any OTHER outbound (manual inbox_sms, ai_reply, smoke test) = a human or
  // the AI is already working this phone — a robotic "didn't hear back" on
  // top of a live thread contradicts it and outs the automation (2026-07-12
  // audit).
  const done = new Set<string>();
  for (const s of args.sends) {
    if (s.direction === "in" || s.kind !== "text_queue") done.add(s.phone);
  }
  const openers = new Map<string, { t: number; reachable: boolean }>();
  for (const s of args.sends) {
    if (s.direction !== "out" || s.kind !== "text_queue") continue;
    const t = s.created_at.getTime();
    // A carrier-rejected opener (landline, bad number) means the nudge would
    // fail identically — don't burn a cap slot on an unreachable phone. A
    // status we haven't heard back on yet counts as reachable.
    const reachable = s.status !== "failed" && s.status !== "undelivered";
    const prev = openers.get(s.phone);
    if (!prev || t < prev.t) {
      openers.set(s.phone, { t, reachable: reachable || (prev?.reachable ?? false) });
    } else if (reachable && !prev.reachable) {
      prev.reachable = true;
    }
  }
  const out = new Map<string, Date>();
  for (const [phone, o] of openers) {
    if (done.has(phone) || args.optedOut.has(phone) || !o.reachable) continue;
    if (o.t <= cutoff && o.t >= oldest) out.set(phone, new Date(o.t));
  }
  return out;
}

export type SmsNudgeTarget = {
  companyId: string;
  companyKey: string;
  name: string;
  phone: string;
  text: string;
};

/** Load-and-match wrapper around selectSmsNudges: attach each silent phone
 *  back to its company (for the name + the freshest claim link) and drop any
 *  that converted or got blocked since the opener. */
export async function smsNudgeTargets(limit: number): Promise<SmsNudgeTarget[]> {
  if (limit <= 0) return [];
  const [sends, optOuts, companies, outreach] = await Promise.all([
    db
      .select({
        direction: smsSend.direction,
        kind: smsSend.kind,
        phone: smsSend.phone,
        created_at: smsSend.created_at,
        status: smsSend.status,
      })
      .from(smsSend),
    db.select({ phone: smsOptOut.phone }).from(smsOptOut),
    db
      .select({
        id: prospectCompany.id,
        key: prospectCompany.key,
        name: prospectCompany.name,
        phone: prospectCompany.phone,
        trade: prospectCompany.trade,
        blocked_at: prospectCompany.blocked_at,
        buyer_id: prospectCompany.buyer_id,
      })
      .from(prospectCompany)
      .where(isNotNull(prospectCompany.phone)),
    db
      .select({
        company_key: buyerOutreach.company_key,
        property_id: buyerOutreach.property_id,
        sent_at: buyerOutreach.sent_at,
      })
      .from(buyerOutreach)
      .where(and(isNotNull(buyerOutreach.claim_url), isNotNull(buyerOutreach.property_id))),
  ]);

  const due = selectSmsNudges({
    now: new Date(),
    sends,
    optedOut: new Set(optOuts.map((o) => o.phone)),
  });
  if (due.size === 0) return [];

  const offerByKey = new Map<string, { propertyId: string; at: number }>();
  for (const o of outreach) {
    const at = o.sent_at?.getTime() ?? 0;
    const prev = offerByKey.get(o.company_key);
    if (!prev || at >= prev.at) offerByKey.set(o.company_key, { propertyId: o.property_id!, at });
  }

  // Deterministic company order so a phone shared by two companies always
  // resolves to the same one — and only ONE nudge per phone regardless.
  const out: SmsNudgeTarget[] = [];
  const nudgedPhones = new Set<string>();
  for (const c of [...companies].sort((a, b) => a.key.localeCompare(b.key))) {
    const phone = toE164(c.phone);
    if (!phone || !due.has(phone) || nudgedPhones.has(phone)) continue;
    if (c.blocked_at || c.buyer_id) continue; // converted/blocked since the opener
    const offer = offerByKey.get(c.key);
    if (!offer) continue; // nothing to deliver
    nudgedPhones.add(phone);
    out.push({
      companyId: c.id,
      companyKey: c.key,
      name: c.name,
      phone,
      text: nudgeTextFor(c.name, freshClaimUrl(offer.propertyId, c.name, c.trade)),
    });
  }
  // Oldest opener first — they've waited longest and their tokens expire first.
  out.sort((a, b) => (due.get(a.phone)?.getTime() ?? 0) - (due.get(b.phone)?.getTime() ?? 0));
  return out.slice(0, limit);
}
