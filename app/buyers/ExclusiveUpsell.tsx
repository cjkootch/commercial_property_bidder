import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, leadUnlock, property } from "@/lib/db/schema";
import { leadKind } from "@/lib/leads/market";
import { leadTierFor } from "@/lib/leads/pricing-tiers";
import { TRADES, asTrade, tradeValueInput } from "@/lib/leads/trades";
import { startExclusiveUpgrade } from "./actions";

/** The peak-belief upsell: shown right after a claim (?claimed=) while the
 *  buyer is still the lead's ONLY holder in their trade — one tap locks out
 *  every competitor. Renders nothing whenever the conditions don't hold. */
export async function ExclusiveUpsell({
  buyerId,
  propertyId,
}: {
  buyerId: string;
  propertyId: string;
}) {
  const [[me], [prop], unlocks] = await Promise.all([
    db.select().from(buyer).where(eq(buyer.id, buyerId)).limit(1),
    db.select().from(property).where(eq(property.id, propertyId)).limit(1),
    db.select().from(leadUnlock).where(eq(leadUnlock.property_id, propertyId)),
  ]);
  if (!me || !prop || prop.archived_at) return null;
  const trade = asTrade(me.trade);
  const mine = unlocks.filter((u) => u.trade === trade);
  const held = mine.find((u) => u.buyer_id === buyerId);
  if (!held || held.kind === "exclusive" || mine.length > 1) return null;

  const kindOfLead = leadKind(prop.name);
  const est = TRADES[trade].estimateValue(tradeValueInput(prop, kindOfLead));
  const tier = leadTierFor(est?.annualHi ?? null, kindOfLead);
  const amount = Math.max(tier.exclusive_cents - (held.kind === "paid" ? tier.price_cents : 0), 500);
  const service = TRADES[trade].service;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <div className="min-w-0">
        <div className="text-sm font-bold text-amber-900">
          🔒 Right now, you hold the only copy of this {service} job.
        </div>
        <p className="mt-0.5 text-sm text-amber-800">
          Lock out every competitor before another company takes a spot — make it exclusively
          yours, permanently, for ${Math.round(amount / 100)}.
        </p>
      </div>
      <form action={startExclusiveUpgrade.bind(null, propertyId)}>
        <button className="rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-amber-700">
          Make it exclusive — ${Math.round(amount / 100)}
        </button>
      </form>
    </div>
  );
}
