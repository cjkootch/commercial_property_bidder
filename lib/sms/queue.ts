// The text queue: suggested first-touch SMS for hot, phone-eligible
// prospects. NOTHING here sends — the operator reviews each suggestion and
// taps Send one at a time (human-initiated, one-to-one; the compliance
// posture in docs/instrumentation.md). The script is the operator's two-step:
// a short human opener, then — once they reply — the pitch with their claim
// link, where Greenkeep is identified and the casual opt-out is offered.

import { isNotNull, isNull, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyerOutreach, prospectCompany, smsOptOut, smsSend } from "@/lib/db/schema";
import { toE164 } from "@/lib/integrations/twilio";

export const TEXT_QUEUE_DAILY_CAP = () => {
  const n = Number(process.env.TEXT_QUEUE_DAILY_CAP);
  return Number.isFinite(n) && n > 0 ? n : 15;
};

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

  type Agg = { opens: number; clicks: number; claimUrl: string | null; claimAt: number };
  const byKey = new Map<string, Agg>();
  for (const o of outreach) {
    const a = byKey.get(o.company_key) ?? { opens: 0, clicks: 0, claimUrl: null, claimAt: 0 };
    if (o.opened_at || o.nudge_opened_at) a.opens++;
    if (o.clicked_at || o.nudge_clicked_at) a.clicks++;
    const at = o.sent_at?.getTime() ?? 0;
    if (o.claim_url && at >= a.claimAt) {
      a.claimUrl = o.claim_url;
      a.claimAt = at;
    }
    byKey.set(o.company_key, a);
  }

  const out: QueueSuggestion[] = [];
  for (const c of companies) {
    const phone = toE164(c.phone);
    if (!phone || alreadyTexted.has(phone) || optedOut.has(phone)) continue;
    const a = byKey.get(c.key);
    if (!a?.claimUrl) continue; // step 2 needs a link to deliver
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
      opener: openerFor(c.name, c.office_city),
      claimUrl: a.claimUrl,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/** Queue sends already made today (Chicago wall clock), for the daily cap. */
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
  return rows.filter((r) => r.kind === "text_queue" && fmt.format(r.created_at) === today).length;
}
