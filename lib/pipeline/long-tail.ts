// The long tail: automotive-style long-term follow-up. A prospect who didn't
// convert in the first sequence isn't dead — they just didn't need a lead that
// week. Every LONG_TAIL_EVERY_DAYS days (max LONG_TAIL_MAX_TOUCHES total) a
// quiet prospect gets ONE re-touch offering a GENUINELY NEW lead near them —
// never "just checking in," always fresh inventory they haven't been pitched.
// Email when we have an address; SMS for phone-only prospects (riding the
// shared daily SMS cap + business-hours window).
//
// Stops forever when: they convert (buyer), opt out / unsubscribe, get blocked,
// or the touch budget is spent. Any engagement re-enters them into the normal
// hot machinery (heat ranking, AI conversation, nudges) automatically.

import { and, isNull, or, isNotNull, inArray } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { sendEmail } from "../integrations/resend";
import { sendSms, toE164, isTextableLineType } from "../integrations/twilio";
import { openInventoryFor } from "../sms/ai-context";
import { OPT_OUT_LINE, withinSmsSendWindow, TEXT_QUEUE_DAILY_CAP } from "../sms/queue";
import { signBuyerUnsub } from "../buyer-auth";
import { toHtml, siteBase } from "./buyer-prospecting";
import { asTrade, TRADES } from "../leads/trades";
import { marketTz } from "../markets";
import { getDefaultCompany } from "../db/queries";
import { rateLimit } from "../ratelimit";

/** Days of silence between long-tail touches. */
export const LONG_TAIL_EVERY_DAYS = 30;
/** Lifetime long-tail touch budget per company — then quiet forever. */
export const LONG_TAIL_MAX_TOUCHES = 4;

export type LongTailCandidate = {
  key: string;
  name: string;
  email: string | null;
  phone: string | null; // E.164 or raw
  trade: string;
  blocked: boolean;
  converted: boolean;
  suppressed: boolean;
  optedOut: boolean;
  /** Most recent outbound touch on ANY channel (null = never touched → not
   *  long-tail's job; the first sequence owns them). */
  lastTouchAt: Date | null;
  /** Long-tail touches already spent. */
  touches: number;
};

/** Pure selector — who is due a long-tail touch right now. Oldest-silence
 *  first, so the prospects waiting longest get the next batch. */
export function selectLongTailTargets(
  rows: LongTailCandidate[],
  opts: { now: Date; limit: number }
): LongTailCandidate[] {
  const cutoff = opts.now.getTime() - LONG_TAIL_EVERY_DAYS * 86_400_000;
  return rows
    .filter(
      (r) =>
        !r.blocked &&
        !r.converted &&
        r.touches < LONG_TAIL_MAX_TOUCHES &&
        r.lastTouchAt != null &&
        r.lastTouchAt.getTime() <= cutoff &&
        // A reachable channel must exist.
        ((!!r.email && !r.suppressed) || (!!r.phone && !r.optedOut))
    )
    .sort((a, b) => (a.lastTouchAt?.getTime() ?? 0) - (b.lastTouchAt?.getTime() ?? 0))
    .slice(0, opts.limit);
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const titleCity = (c: string | null) =>
  c?.trim().toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()) ?? null;

export type LongTailSummary = {
  considered: number;
  due: number;
  emailed: number;
  texted: number;
  skippedNoNewLead: number;
  skippedSmsWindowOrCap: number;
};

export async function runLongTail(limit = 40): Promise<LongTailSummary> {
  const now = new Date();
  const [companies, outreach, sms, emailLog, suppressed, optOuts] = await Promise.all([
    db
      .select({
        key: schema.prospectCompany.key,
        name: schema.prospectCompany.name,
        email: schema.prospectCompany.email,
        phone: schema.prospectCompany.phone,
        trade: schema.prospectCompany.trade,
        website: schema.prospectCompany.website,
        city: schema.prospectCompany.office_city,
        lat: schema.prospectCompany.office_lat,
        lng: schema.prospectCompany.office_lng,
        line_type: schema.prospectCompany.line_type,
        blocked_at: schema.prospectCompany.blocked_at,
        buyer_id: schema.prospectCompany.buyer_id,
      })
      .from(schema.prospectCompany)
      .where(
        and(
          isNull(schema.prospectCompany.blocked_at),
          isNull(schema.prospectCompany.buyer_id),
          or(isNotNull(schema.prospectCompany.email), isNotNull(schema.prospectCompany.phone))
        )
      ),
    db
      .select({
        company_key: schema.buyerOutreach.company_key,
        property_id: schema.buyerOutreach.property_id,
        sent_at: schema.buyerOutreach.sent_at,
      })
      .from(schema.buyerOutreach)
      .where(isNotNull(schema.buyerOutreach.sent_at)),
    db
      .select({
        phone: schema.smsSend.phone,
        direction: schema.smsSend.direction,
        kind: schema.smsSend.kind,
        created_at: schema.smsSend.created_at,
      })
      .from(schema.smsSend),
    db
      .select({ to_email: schema.emailSend.to_email, kind: schema.emailSend.kind, created_at: schema.emailSend.created_at })
      .from(schema.emailSend),
    db.select({ email: schema.suppression.email }).from(schema.suppression),
    db.select({ phone: schema.smsOptOut.phone }).from(schema.smsOptOut),
  ]);

  const suppressedSet = new Set(suppressed.map((s) => s.email.toLowerCase()));
  const optedOutSet = new Set(optOuts.map((o) => o.phone));

  // Per-company aggregates: last outbound touch on any channel, long-tail
  // touch count, and every property already offered (never re-pitch one).
  const lastOutreach = new Map<string, number>();
  const offeredProps = new Map<string, Set<string>>();
  for (const o of outreach) {
    const t = o.sent_at?.getTime() ?? 0;
    if (t > (lastOutreach.get(o.company_key) ?? 0)) lastOutreach.set(o.company_key, t);
    if (o.property_id) {
      const s = offeredProps.get(o.company_key) ?? new Set<string>();
      s.add(o.property_id);
      offeredProps.set(o.company_key, s);
    }
  }
  const lastSmsByPhone = new Map<string, number>();
  const smsTailByPhone = new Map<string, number>();
  for (const s of sms) {
    if (s.direction !== "out") continue;
    const t = s.created_at.getTime();
    if (t > (lastSmsByPhone.get(s.phone) ?? 0)) lastSmsByPhone.set(s.phone, t);
    if (s.kind === "long_tail") smsTailByPhone.set(s.phone, (smsTailByPhone.get(s.phone) ?? 0) + 1);
  }
  const emailTailByAddr = new Map<string, number>();
  const lastEmailByAddr = new Map<string, number>();
  for (const e of emailLog) {
    const addr = e.to_email.toLowerCase();
    const t = e.created_at.getTime();
    if (t > (lastEmailByAddr.get(addr) ?? 0)) lastEmailByAddr.set(addr, t);
    if (e.kind === "long_tail") emailTailByAddr.set(addr, (emailTailByAddr.get(addr) ?? 0) + 1);
  }

  const candidates: (LongTailCandidate & {
    website: string | null;
    city: string | null;
    lat: number | null;
    lng: number | null;
    line_type: string | null;
  })[] = companies.map((c) => {
    const phone = toE164(c.phone);
    const addr = c.email?.toLowerCase() ?? null;
    const last = Math.max(
      lastOutreach.get(c.key) ?? 0,
      phone ? lastSmsByPhone.get(phone) ?? 0 : 0,
      addr ? lastEmailByAddr.get(addr) ?? 0 : 0
    );
    return {
      key: c.key,
      name: c.name,
      email: c.email,
      phone,
      trade: c.trade,
      blocked: !!c.blocked_at,
      converted: !!c.buyer_id,
      suppressed: !!addr && suppressedSet.has(addr),
      optedOut: !!phone && optedOutSet.has(phone),
      lastTouchAt: last ? new Date(last) : null,
      touches: (addr ? emailTailByAddr.get(addr) ?? 0 : 0) + (phone ? smsTailByPhone.get(phone) ?? 0 : 0),
      website: c.website,
      city: c.city,
      lat: c.lat,
      lng: c.lng,
      line_type: c.line_type,
    };
  });

  const due = selectLongTailTargets(candidates, { now, limit });
  const co = await getDefaultCompany();
  const brand = co?.name ?? "Greenkeep";
  const summary: LongTailSummary = {
    considered: candidates.length,
    due: due.length,
    emailed: 0,
    texted: 0,
    skippedNoNewLead: 0,
    skippedSmsWindowOrCap: 0,
  };

  for (const t of due as typeof candidates) {
    // A NEW lead near them they haven't been pitched — the whole premise.
    const inv = await openInventoryFor({
      companyName: t.name,
      trade: asTrade(t.trade),
      lat: t.lat,
      lng: t.lng,
      limit: 4,
    });
    const seen = offeredProps.get(t.key) ?? new Set<string>();
    const fresh = inv.find((i) => !seen.has(i.propertyId));
    if (!fresh) {
      summary.skippedNoNewLead++;
      continue;
    }
    const service = TRADES[asTrade(t.trade)].service;
    const city = titleCity(fresh.city ?? t.city);
    const value =
      fresh.valueLo != null && fresh.valueHi != null
        ? `, est. ${usd(fresh.valueLo)}-${usd(fresh.valueHi)}/yr`
        : "";

    const preferEmail = !!t.email && !t.suppressed;
    if (preferEmail) {
      const body =
        `${t.name} team —\n\n` +
        `A new ${service} job just landed${city ? ` in ${city}` : " near you"}${value}. ` +
        `Each job goes to one company — opening it gives you first claim for 24h:\n\n` +
        `${fresh.claimUrl}\n\n` +
        `No charge to look. If the timing's finally right, it's yours.\n\n— ${brand}`;
      const unsubUrl = `${siteBase()}/api/unsubscribe?token=${encodeURIComponent(signBuyerUnsub(t.email!))}`;
      const res = await sendEmail({
        to: t.email!,
        subject: `New ${city ? `${city} ` : ""}${service} job — first claim is open`,
        html: toHtml(body, unsubUrl, co?.physical_mailing_address ?? null),
        text: `${body}\n\nUnsubscribe: ${unsubUrl}`,
        stream: "campaign",
        tags: { kind: "long_tail" },
        logAs: { kind: "long_tail", refId: fresh.propertyId },
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      if (res.ok) {
        summary.emailed++;
        await recordOutreach(t, fresh.propertyId, fresh.claimUrl, body);
      }
    } else if (t.phone && !t.optedOut && isTextableLineType(t.line_type)) {
      // SMS long-tail: business-hours window + the shared daily cap ledger.
      if (!withinSmsSendWindow(now, marketTz(t.lat, t.lng))) {
        summary.skippedSmsWindowOrCap++;
        continue;
      }
      if (!(await rateLimit("smsqueue:day", TEXT_QUEUE_DAILY_CAP(), 86_400)).ok) {
        summary.skippedSmsWindowOrCap++;
        continue;
      }
      const text =
        `New one for ${t.name} — a ${city ? `${city} ` : ""}${service} job${value}. ` +
        `Opening it gives you first claim for 24h: ${fresh.claimUrl}\n\n` +
        `${OPT_OUT_LINE}\n-Cole, ${brand}`;
      const res = await sendSms({
        to: t.phone,
        body: text,
        kind: "long_tail",
        companyKey: t.key,
      });
      if (res.ok) {
        summary.texted++;
        await recordOutreach(t, fresh.propertyId, fresh.claimUrl, text);
      }
    }
  }
  return summary;

  /** The touch is a first-class outreach: recording it keeps the whole
   *  machine coherent (AI replies reference the NEW lead, claim heat and the
   *  engaged-only email nudge attach to it, and it joins the never-re-pitch
   *  set for future long-tail rounds). */
  async function recordOutreach(
    t: (typeof candidates)[number],
    propertyId: string,
    claimUrl: string,
    message: string
  ) {
    await db
      .insert(schema.buyerOutreach)
      .values({
        property_id: propertyId,
        company_key: t.key,
        company_name: t.name,
        website: t.website,
        email: t.email,
        phone: t.phone,
        office_city: t.city,
        office_lat: t.lat,
        office_lng: t.lng,
        claim_url: claimUrl,
        message: `LONG_TAIL: ${message}`,
        status: "sent",
        sent_at: new Date(),
      })
      .onConflictDoNothing()
      .catch((e) => console.error("long-tail outreach record failed:", e));
    const s = offeredProps.get(t.key) ?? new Set<string>();
    s.add(propertyId);
    offeredProps.set(t.key, s);
  }
}
