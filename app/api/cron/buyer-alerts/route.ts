import { NextRequest } from "next/server";
import { and, gte, isNotNull, isNull } from "drizzle-orm";
import { guarded } from "@/lib/cron-guard";
import { db } from "@/lib/db";
import { buyer, leadUnlock, property, smsSend } from "@/lib/db/schema";
import { sendSms } from "@/lib/integrations/twilio";
import { freshClaimUrl, withinSmsSendWindow } from "@/lib/sms/queue";
import { leadAvailability } from "@/lib/leads/availability";
import { TRADES, asTrade } from "@/lib/leads/trades";
import { haversineMiles } from "@/lib/sourcing/criteria";
import { getDefaultCompany } from "@/lib/db/queries";

// SMS lead alerts for buyers: when a fresh sellable job lands inside a
// buyer's service radius, text them — the retention loop for the phone-first
// accounts the SMS channel acquires. Consent basis: these are OUR buyers
// (created a profile, notify on) getting the product they signed up for,
// on the number they gave us. Rails: business-hours window, at most ONE
// alert per buyer per run (the best new job), one alert per buyer+property
// ever, opted-out numbers refused by sendSms, kill switch BUYER_SMS_ALERTS=0.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_PER_RUN = 30;
/** How fresh a property must be to count as "new" (daily cron + margin). */
const FRESH_HOURS = 26;

export async function GET(req: NextRequest) {
  return guarded("buyer-alerts", async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (process.env.BUYER_SMS_ALERTS === "0") {
      return Response.json({ skipped: "BUYER_SMS_ALERTS=0" });
    }
    if (!withinSmsSendWindow(new Date())) {
      return Response.json({ skipped: "outside business-hours send window" });
    }

    const [buyers, fresh, priorAlerts, unlocks] = await Promise.all([
      db
        .select()
        .from(buyer)
        .where(and(isNotNull(buyer.phone), isNotNull(buyer.lat))),
      db
        .select()
        .from(property)
        .where(
          and(
            gte(property.created_at, new Date(Date.now() - FRESH_HOURS * 3600_000)),
            isNull(property.archived_at),
            isNull(property.lead_exported_at),
            isNotNull(property.lat)
          )
        ),
      db.select({ ref_id: smsSend.ref_id }).from(smsSend),
      db.select({ property_id: leadUnlock.property_id, buyer_id: leadUnlock.buyer_id }).from(leadUnlock),
    ]);
    if (buyers.length === 0 || fresh.length === 0) {
      return Response.json({ sent: [], scanned: { buyers: buyers.length, fresh: fresh.length } });
    }
    const alreadyAlerted = new Set(priorAlerts.map((r) => r.ref_id));
    const held = new Set(unlocks.map((u) => `${u.property_id}:${u.buyer_id}`));
    const co = await getDefaultCompany();
    const brand = co?.name ?? "Greenkeep";

    const sent: Array<{ buyer: string; property: string; sid?: string; error?: string }> = [];
    for (const b of buyers) {
      if (sent.length >= MAX_PER_RUN) break;
      if (!b.notify || !b.phone) continue;
      const trade = asTrade(b.trade);
      // Sellable = same rule as the shelf: parcel measured, or a public bid.
      const candidates = fresh
        .filter(
          (p) =>
            (p.parcel_geojson != null || / \(RFP [^)]+\)$/.test(p.name)) &&
            !held.has(`${p.id}:${b.id}`) &&
            !alreadyAlerted.has(`lead_alert:${p.id}:${b.id}`)
        )
        .map((p) => ({
          p,
          miles: haversineMiles([b.lng!, b.lat!], [p.lng!, p.lat!]),
          teaser: p.lead_teaser as { annual_lo?: number; annual_hi?: number } | null,
        }))
        .filter((x) => x.miles <= b.service_radius_mi)
        .sort((a, z) => (z.teaser?.annual_hi ?? 0) - (a.teaser?.annual_hi ?? 0));
      const best = candidates[0];
      if (!best) continue;
      const avail = await leadAvailability(best.p, trade);
      if (!avail.open) continue;

      const service = TRADES[trade].service;
      const value =
        best.teaser?.annual_lo && best.teaser?.annual_hi
          ? ` — est $${Math.round(best.teaser.annual_lo / 1000)}k–$${Math.round(best.teaser.annual_hi / 1000)}k/yr`
          : "";
      const url = freshClaimUrl(best.p.id, b.company_name, trade);
      const res = await sendSms({
        to: b.phone,
        body:
          `New ${service} job ~${Math.max(1, Math.round(best.miles))} mi from you${value}. ` +
          `First to claim wins a spot: ${url}\n\n-${brand}`,
        kind: "lead_alert",
        buyerId: b.id,
        refId: `lead_alert:${best.p.id}:${b.id}`,
      });
      sent.push(
        res.ok
          ? { buyer: b.company_name, property: best.p.id, sid: res.sid }
          : { buyer: b.company_name, property: best.p.id, error: res.error }
      );
    }

    return Response.json({ scanned: { buyers: buyers.length, fresh: fresh.length }, sent });
  });
}
