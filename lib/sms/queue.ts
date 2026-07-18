// The text queue: suggested first-touch SMS for hot, phone-eligible
// prospects. NOTHING here sends — the operator reviews each suggestion and
// taps Send one at a time (human-initiated, one-to-one; the compliance
// posture in docs/instrumentation.md). The script is the operator's two-step:
// a short human opener, then — once they reply — the pitch with their claim
// link, where Greenkeep is identified and the casual opt-out is offered.

import { isNotNull, isNull, and, inArray, like, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyerOutreach, property, prospectCompany, smsOptOut, smsSend } from "@/lib/db/schema";
import { toE164, isTextableLineType } from "@/lib/integrations/twilio";
import { signBuyerClaim } from "@/lib/buyer-auth";
import { DEFAULT_TZ, marketTimezones } from "@/lib/markets";
import { asTrade, TRADES } from "@/lib/leads/trades";
import { usdShort, type AttomFacts } from "@/lib/integrations/attom";
import { resiMaxBuyers } from "@/lib/residential/availability";

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

/** TCPA quiet-hours gate — 8am–9pm on the RECIPIENT's local clock. Broader than
 *  the 9am–6pm cold-outreach window: a reply to a live inbound is fine in the
 *  evening, but an auto-reply must never fire at, say, 11pm. Used to gate the
 *  webhook auto-reply; pass the recipient's market tz (marketTz(lat,lng)). */
export function withinTcpaHours(now: Date, tz: string = DEFAULT_TZ): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false })
      .formatToParts(now)
      .find((p) => p.type === "hour")?.value
  );
  // hour12:false yields 0–23 (some runtimes emit 24 for midnight — treat as 0).
  const h = hour === 24 ? 0 : hour;
  return h >= 8 && h < 21;
}

/** Step 1. Rewritten 2026-07-18 (operator direction, off launch-day reply
 *  data): the identity-check opener ("Hi, is this X?") is replaced by a
 *  direct, answerable OFFER question — the pitch in one line. Kind matters
 *  for honesty: "free lead" is only true on the commercial side; a company
 *  whose live offer is a PAID residential list gets the list question
 *  instead (a free-lead opener there is bait-and-switch and earns Stops). */
export function openerFor(
  name: string,
  city: string | null,
  kind: "commercial" | "residential" = "commercial"
): string {
  if (kind === "residential") {
    return `Hey, would you like the addresses of homeowners who just bought houses${city ? ` near ${city}` : " in your area"}?`;
  }
  return "Hey, would you like a free lead on a large commercial job?";
}

/** The casual opt-out line — used once per conversation, in step 2. Twilio
 *  still honors a literal STOP reply automatically regardless of wording. */
export const OPT_OUT_LINE = "Just let me know if you're not interested.";

/** Step 2 — sent manually from the thread after they reply. Trust-first: the
 *  warm human opener must not hard-pivot into "click this link" (that pivot got
 *  a Stop on 2026-07-13 and stalled every reply). Disarm the sales worry, name
 *  the ONE opportunity, then present the link as low-commitment ("free, no
 *  card") — one ask, not a stack. Identifies the business (CTIA) + opt-out. */
export function step2For(name: string, claimUrl: string): string {
  return (
    `Not selling anything — I run Greenkeep. Each lead goes to one company. ` +
    `Open this one and you've got first claim on the free spot for 24h (while ` +
    `the job's still open) — after that it passes to the next company. Free, no ` +
    `card: ${claimUrl}\n\n${OPT_OUT_LINE}\n-Cole, Greenkeep`
  );
}

/** Step 2 for a RESIDENTIAL package thread — a paid address list, so no
 *  free-lead / 24h-hold framing (that would be dishonest here). */
export function resiStep2For(name: string, url: string): string {
  return (
    `Not selling a job lead — I run Greenkeep. We pull every recent home sale in ` +
    `your area from county records; new owners are hiring right now and ${name} ` +
    `could be first through the door. At most ${resiMaxBuyers()} companies in your ` +
    `trade ever get each list. One-time, CSV included: ${url}\n\n${OPT_OUT_LINE}\n-Cole, Greenkeep`
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
  website: string | null; // for the Apollo cell-reveal domain hint
  cellLookupAt: Date | null; // last owner-cell reveal attempt (attempt-once)
  opener: string;
  claimUrl: string;
  /** What step 2 delivers: a commercial claim link or a residential package. */
  kind: "commercial" | "residential";
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
        website: prospectCompany.website,
        cell_lookup_at: prospectCompany.cell_lookup_at,
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
        created_at: buyerOutreach.created_at,
        opened_at: buyerOutreach.opened_at,
        clicked_at: buyerOutreach.clicked_at,
        nudge_opened_at: buyerOutreach.nudge_opened_at,
        nudge_clicked_at: buyerOutreach.nudge_clicked_at,
      })
      .from(buyerOutreach)
      // Sent rows AND residential package rows: a phone-only company gets a
      // "skipped" respkg row (no email to send) whose URL is still the live
      // offer — without this they'd be unreachable on BOTH channels.
      .where(or(isNotNull(buyerOutreach.sent_at), like(buyerOutreach.claim_url, "%respkg=%"))),
    db.select({ phone: smsSend.phone }).from(smsSend),
    db.select({ phone: smsOptOut.phone }).from(smsOptOut),
  ]);

  const alreadyTexted = new Set(texted.map((t) => t.phone));
  const optedOut = new Set(optOuts.map((o) => o.phone));

  type Agg = {
    opens: number;
    clicks: number;
    propertyId: string | null;
    claimAt: number;
    /** Latest residential package pitch (respkg URL — stable, no token TTL). */
    resiUrl: string | null;
    resiAt: number;
  };
  const byKey = new Map<string, Agg>();
  for (const o of outreach) {
    const a =
      byKey.get(o.company_key) ??
      { opens: 0, clicks: 0, propertyId: null, claimAt: 0, resiUrl: null, resiAt: 0 };
    if (o.opened_at || o.nudge_opened_at) a.opens++;
    if (o.clicked_at || o.nudge_clicked_at) a.clicks++;
    const at = o.sent_at?.getTime() ?? 0;
    if (o.claim_url && o.property_id && at >= a.claimAt) {
      a.propertyId = o.property_id;
      a.claimAt = at;
    } else if (o.claim_url && !o.property_id && o.claim_url.includes("respkg=")) {
      // Never-emailed rows have no sent_at — their creation time still
      // establishes offer recency for the latest-offer-wins rule.
      const resiAt = (o.sent_at ?? o.created_at)?.getTime() ?? 0;
      if (resiAt >= a.resiAt) {
        a.resiUrl = o.claim_url;
        a.resiAt = resiAt;
      }
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
    if (!a?.propertyId && !a?.resiUrl) continue; // step 2 needs something to deliver
    // Most recent offer wins the thread: a company pitched a residential
    // package yesterday gets the residential step 2, not last week's job.
    const resi = !!a.resiUrl && a.resiAt >= a.claimAt;
    // Every prospect with a phone + a lead to offer is textable — SMS is not
    // reserved for the already-engaged (operator decision 2026-07-14: "all
    // prospects get a text and email"). Score still RANKS them so the daily cap
    // works the warmest first and drains down to cold over successive runs; it
    // no longer gates. (The deliverability/compliance guards above — valid
    // number, line-screen, opt-out, dedupe, per-day cap — all still apply.)
    const score = c.claim_views * 5 + a.clicks * 3 + a.opens + (c.email ? 0 : 2);
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
      website: c.website,
      cellLookupAt: c.cell_lookup_at,
      opener: openerFor(c.name, c.office_city, resi ? "residential" : "commercial"),
      claimUrl: resi ? a.resiUrl! : freshClaimUrl(a.propertyId!, c.name, c.trade),
      kind: resi ? "residential" : "commercial",
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
 *  earned, identifies the business (CTIA), carries the casual opt-out.
 *  Leans on the two honest hooks (2026-07-14): the lead's REAL dollar size
 *  (from the teaser estimate, when sized) and the enforced 24h first-claim
 *  hold — one scarcity fact, not a stack; everything literally true. */
export function nudgeTextFor(
  name: string,
  claimUrl: string,
  opts?: {
    city?: string | null;
    service?: string | null;
    estLo?: number | null;
    estHi?: number | null;
    /** ATTOM county valuation of the property itself — "at a $2.1M property"
     *  reads as insider knowledge (it is) and sizes the stakes honestly. */
    propertyValue?: number | null;
  }
): string {
  const city = opts?.city
    ?.trim()
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
  const at = opts?.propertyValue ? ` at a ${usdShort(opts.propertyValue)} property` : "";
  const what = `a ${city ? `${city} ` : ""}${opts?.service ?? "commercial"} job${at}`;
  const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const value =
    opts?.estLo && opts?.estHi ? `, est. ${usd(opts.estLo)}-${usd(opts.estHi)}/yr` : "";
  return (
    `Didn't hear back, so I'll just send it over — ${what}${value}. Each lead ` +
    `goes to one company; opening this gives ${name} first claim for 24h: ${claimUrl}\n\n` +
    `${OPT_OUT_LINE}\n\n-Cole, Greenkeep`
  );
}

/** The residential no-reply follow-up: same one-follow-up promise, but the
 *  product is a paid homeowner-address list — no job, no claim, no 24h hold
 *  language (that framing would be dishonest here). */
export function resiNudgeTextFor(name: string, url: string): string {
  return (
    `Didn't hear back, so here it is — the new-homeowner address list for ${name}'s area ` +
    `(recent sales, straight from county records). At most ${resiMaxBuyers()} companies in ` +
    `your trade get it. One-time, CSV included: ${url}\n\n` +
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
        claim_url: buyerOutreach.claim_url,
        sent_at: buyerOutreach.sent_at,
        created_at: buyerOutreach.created_at,
      })
      .from(buyerOutreach)
      .where(isNotNull(buyerOutreach.claim_url)),
  ]);

  const due = selectSmsNudges({
    now: new Date(),
    sends,
    optedOut: new Set(optOuts.map((o) => o.phone)),
  });
  if (due.size === 0) return [];

  // Latest offer wins the follow-up: commercial rows carry a property id,
  // residential package pitches carry a stable respkg URL instead.
  const offerByKey = new Map<string, { propertyId: string | null; resiUrl: string | null; at: number }>();
  for (const o of outreach) {
    const isResi = !o.property_id && !!o.claim_url?.includes("respkg=");
    if (!o.property_id && !isResi) continue;
    // Residential recency falls back to created_at — phone-only companies get
    // a "skipped" respkg row (never emailed, sent_at NULL) that IS the live
    // offer. Same rule as suggestedTexts; without it the nudge and the opener
    // could pick OPPOSITE products for one company (2026-07-17 audit).
    const at = (o.sent_at ?? (isResi ? o.created_at : null))?.getTime() ?? 0;
    const prev = offerByKey.get(o.company_key);
    if (!prev || at >= prev.at) {
      offerByKey.set(o.company_key, {
        propertyId: o.property_id ?? null,
        resiUrl: isResi ? o.claim_url! : null,
        at,
      });
    }
  }

  // The lead's city + teaser estimate power the nudge's value line ("a Houston
  // cleaning job, est. $6,600-$12,300/yr") — real numbers, fetched once for the
  // offered properties. Absent teaser → the copy degrades gracefully.
  const offeredIds = [
    ...new Set([...offerByKey.values()].map((o) => o.propertyId).filter(Boolean) as string[]),
  ];
  const props = offeredIds.length
    ? await db
        .select({ id: property.id, city: property.city, lead_teaser: property.lead_teaser, attom: property.attom })
        .from(property)
        .where(inArray(property.id, offeredIds))
    : [];
  const propById = new Map(props.map((p) => [p.id, p]));

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
    if (offer.resiUrl) {
      out.push({
        companyId: c.id,
        companyKey: c.key,
        name: c.name,
        phone,
        text: resiNudgeTextFor(c.name, offer.resiUrl),
      });
      continue;
    }
    const p = propById.get(offer.propertyId!);
    const teaser = (p?.lead_teaser ?? null) as { annual_lo?: number; annual_hi?: number } | null;
    // Cached ATTOM county valuation (read-only here — never a fetch): sizes
    // the stakes in the nudge when the offer-time enrichment found one.
    const facts = (p?.attom ?? null) as AttomFacts | null;
    out.push({
      companyId: c.id,
      companyKey: c.key,
      name: c.name,
      phone,
      text: nudgeTextFor(c.name, freshClaimUrl(offer.propertyId!, c.name, c.trade), {
        city: p?.city ?? null,
        service: TRADES[asTrade(c.trade)].service,
        estLo: teaser?.annual_lo ?? null,
        estHi: teaser?.annual_hi ?? null,
        propertyValue: facts?.status === "ok" ? facts.market_value ?? facts.assessed_value : null,
      }),
    });
  }
  // Oldest opener first — they've waited longest and their tokens expire first.
  out.sort((a, b) => (due.get(a.phone)?.getTime() ?? 0) - (due.get(b.phone)?.getTime() ?? 0));
  return out.slice(0, limit);
}
