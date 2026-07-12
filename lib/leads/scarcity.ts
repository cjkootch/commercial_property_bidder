// True-scarcity alerts: when a lead a company was offered drops to its LAST
// shared spot for their trade, tell them — once, ever, per company+property.
// Our scarcity is real (hard per-trade caps), which makes this the rare
// urgency email that is simply a fact. Fired after every successful unlock
// (free claim, credit unlock, Stripe webhook) via waitUntil — never blocks
// the purchase path, never throws.

import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { buyerOutreach, emailSend, property, prospectCompany, suppression } from "../db/schema";
import { sendEmail } from "../integrations/resend";
import { signBuyerUnsub } from "../buyer-auth";
import { freshClaimUrl } from "../sms/queue";
import { leadAvailability, leadMaxBuyers } from "./availability";
import { displayName } from "./market";
import { TRADES, asTrade } from "./trades";
import { getDefaultCompany } from "../db/queries";
import { siteBase, toHtml } from "../pipeline/buyer-prospecting";

const KIND = "spot_alert";
/** One unlock event never blasts more than this many companies. */
const MAX_PER_EVENT = 10;

export async function alertLastSpot(propertyId: string): Promise<void> {
  try {
    const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
    if (!prop || prop.archived_at || prop.lead_exported_at) return;

    const offers = await db
      .select({
        company_key: buyerOutreach.company_key,
        email: buyerOutreach.email,
        opened_at: buyerOutreach.opened_at,
        clicked_at: buyerOutreach.clicked_at,
      })
      .from(buyerOutreach)
      .where(and(eq(buyerOutreach.property_id, propertyId), isNotNull(buyerOutreach.email)));
    if (offers.length === 0) return;

    const [alreadyRows, companies, suppressed] = await Promise.all([
      db.select({ ref_id: emailSend.ref_id }).from(emailSend).where(eq(emailSend.kind, KIND)),
      db
        .select({
          key: prospectCompany.key,
          name: prospectCompany.name,
          trade: prospectCompany.trade,
          buyer_id: prospectCompany.buyer_id,
          blocked_at: prospectCompany.blocked_at,
          claim_views: prospectCompany.claim_views,
        })
        .from(prospectCompany),
      db.select({ email: suppression.email }).from(suppression),
    ]);
    const already = new Set(alreadyRows.map((r) => r.ref_id));
    const byKey = new Map(companies.map((c) => [c.key, c]));
    const suppressedSet = new Set(suppressed.map((s) => s.email.toLowerCase()));

    const co = await getDefaultCompany();
    const brand = co?.name ?? "Greenkeep";
    const cap = leadMaxBuyers();
    // Availability is per-trade — cache per trade so ten offers don't recount.
    const availByTrade = new Map<string, { open: boolean; spotsLeft: number }>();

    let sent = 0;
    const seenCompany = new Set<string>();
    for (const o of offers) {
      if (sent >= MAX_PER_EVENT) break;
      const c = byKey.get(o.company_key);
      if (!c || c.buyer_id || c.blocked_at || seenCompany.has(c.key)) continue;
      seenCompany.add(c.key);
      if (!o.email || suppressedSet.has(o.email.toLowerCase())) continue;
      // Engaged only — a company that never opened anything doesn't get an
      // urgency email about a job it never looked at.
      if (!o.opened_at && !o.clicked_at && (c.claim_views ?? 0) === 0) continue;
      const ref = `${propertyId}:${c.key}`;
      if (already.has(ref)) continue;

      const trade = asTrade(c.trade);
      let avail = availByTrade.get(trade);
      if (!avail) {
        avail = await leadAvailability(prop, trade);
        availByTrade.set(trade, avail);
      }
      // Fires ONLY at the last-spot moment — not every unlock.
      if (!avail.open || avail.spotsLeft !== 1) continue;

      const service = TRADES[trade].service;
      const url = freshClaimUrl(propertyId, c.name, trade);
      const unsubUrl = `${siteBase()}/api/unsubscribe?token=${encodeURIComponent(signBuyerUnsub(o.email))}`;
      const body = `${c.name} team —

The ${prop.city ? `${prop.city} ` : ""}${service} job we sent you is down to its LAST spot — ${cap - 1} of ${cap} just went to other companies. When it's taken, the job closes for good.

See it before it's gone:

${url}

This is a fact, not a countdown timer — our caps are hard. We won't email you about this one again.

— ${brand}`;
      const res = await sendEmail({
        to: o.email,
        subject: `Last spot — the ${prop.city ? `${prop.city} ` : ""}${service} job (${displayName(prop.name).slice(0, 40)})`,
        html: toHtml(body, unsubUrl, co?.physical_mailing_address ?? null),
        tags: { kind: KIND },
        logAs: { kind: KIND, refId: ref },
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      if (res.ok) sent++;
    }
  } catch (e) {
    console.error("alertLastSpot failed:", e);
  }
}
