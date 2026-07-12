// Knowledge the SMS AI answers from: a factual program brief plus the LIVE
// inventory relevant to the prospect (their trade, their metro), each item
// carrying a freshly-minted claim link the AI may send. Everything stated
// here must stay true in code — the brief quotes the same pricing module,
// caps, and claim flow every other surface uses.

import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyerOutreach, property } from "@/lib/db/schema";
import { getDefaultCompany, listDashboard } from "@/lib/db/queries";
import { signBuyerClaim } from "@/lib/buyer-auth";
import { leadMaxBuyers } from "@/lib/leads/availability";
import { marketForCoords } from "@/lib/markets";

export const PROGRAM_BRIEF = `How Greenkeep works (answer questions from these facts ONLY):
- We monitor public signals — building permits, new business licenses (TABC), county property records, tax sales, government RFPs — across Texas metros, and turn them into verified commercial service opportunities.
- The prospect's first matching lead is usually FREE to claim (premium leads excluded). Claiming takes ~1 minute: open the link, confirm company details, the full sheet unlocks.
- A full job sheet reveals: exact property location, decision-maker contacts, our aerial measurement/sizing, estimated contract value, why the property needs service now, and the window to bid. A ready-to-send intro letter is included.
- Paid leads are priced by contract value: roughly $39 / $79 / $129 per lead depending on size (exclusive access, which locks out competitors, runs about $99–$299). No subscription required to buy leads.
- Scarcity: a lead is sold to at most ${leadMaxBuyers()} companies in a trade, then it closes. Exclusive purchase closes it immediately.
- First Look (optional subscription) shows members brand-new leads before the public shelf.
- We are a lead marketplace only — we never take a cut of their contract, and their customer data stays theirs.
If asked something outside these facts (refunds, legal, custom deals), say Cole will follow up directly.`;

export type InventoryItem = {
  propertyId: string;
  city: string | null;
  valueLo: number | null;
  valueHi: number | null;
  reasons: string[];
  claimUrl: string;
};

/** Live, sellable leads in the given metro — each with a claim link minted
 *  for THIS company. Excludes the lead already under discussion. Shared by
 *  the SMS AI (offers alternatives) and the claim page (the "more
 *  opportunities" carousel). */
export async function openInventoryFor(args: {
  /** Null for unmatched senders — the claim page asks them to fill it in. */
  companyName: string | null;
  trade: string;
  lat: number | null;
  lng: number | null;
  excludePropertyId?: string | null;
  limit?: number;
}): Promise<InventoryItem[]> {
  try {
    const co = await getDefaultCompany();
    if (!co) return [];
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://greenkeep.us").replace(/\/$/, "");
    const marketKey = marketForCoords(args.lat, args.lng).key;

    const rows = await listDashboard(co.id);
    const candidates = rows.filter(
      (r) => r.sellable && !r.archived && r.id !== args.excludePropertyId
    );
    if (candidates.length === 0) return [];
    // DashboardRow has no coords — fetch them to scope to the prospect's metro.
    const coords = await db
      .select({ id: property.id, lat: property.lat, lng: property.lng })
      .from(property)
      .where(inArray(property.id, candidates.map((r) => r.id)));
    const coordById = new Map(coords.map((c) => [c.id, c]));
    return candidates
      .filter((r) => {
        const c = coordById.get(r.id);
        return marketForCoords(c?.lat, c?.lng).key === marketKey;
      })
      .sort((a, b) => (b.teaser_hi ?? 0) - (a.teaser_hi ?? 0))
      .slice(0, args.limit ?? 3)
      .map((r) => ({
        propertyId: r.id,
        city: r.city,
        valueLo: r.teaser_lo,
        valueHi: r.teaser_hi,
        reasons: r.lead_reasons.slice(0, 2),
        claimUrl: `${base}/buyers/claim/${signBuyerClaim(r.id, args.companyName || null)}?trade=${args.trade}`,
      }));
  } catch (e) {
    console.error("openInventoryFor failed:", e);
    return [];
  }
}

/** The inventory as a compact text block for the SMS model, or null. */
export async function inventoryContextFor(args: {
  companyName: string | null;
  trade: string;
  lat: number | null;
  lng: number | null;
  excludePropertyId?: string | null;
}): Promise<string | null> {
  const items = await openInventoryFor(args);
  if (items.length === 0) return null;
  const lines = items.map((i) => {
    const value =
      i.valueLo != null && i.valueHi != null
        ? ` est $${Math.round(i.valueLo / 1000)}k–$${Math.round(i.valueHi / 1000)}k/yr`
        : "";
    const why = i.reasons.join(", ");
    return `- ${i.city ?? "their metro"}:${value}${why ? ` (${why})` : ""} → ${i.claimUrl}`;
  });
  return `Other open opportunities in their area you MAY offer (send at most one, only if the current one isn't a fit or they ask what else is available):\n${lines.join("\n")}`;
}

/** One line describing the lead already offered to this company (their most
 *  recent campaign offer) so the AI knows what "it" refers to. */
export async function currentOpportunityFor(companyKey: string): Promise<string | null> {
  try {
    const [offer] = await db
      .select({ message: buyerOutreach.message, property_id: buyerOutreach.property_id })
      .from(buyerOutreach)
      .where(eq(buyerOutreach.company_key, companyKey))
      .orderBy(desc(buyerOutreach.sent_at))
      .limit(1);
    if (!offer?.message) return null;
    // The campaign email body already describes the lead teaser-safely —
    // give the model its first ~500 chars as grounding.
    return `The opportunity already offered to them (from our email):\n${offer.message.slice(0, 500)}`;
  } catch {
    return null;
  }
}
