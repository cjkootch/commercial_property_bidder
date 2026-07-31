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
import { PACKAGE_MAX_CENTS, PACKAGE_MIN_CENTS } from "@/lib/residential/economics";
import { marketForCoords } from "@/lib/markets";

export const PROGRAM_BRIEF = `How Greenkeep works (answer questions from these facts ONLY):
- We monitor public signals — building permits, new business licenses (TABC), county property records, tax sales, government RFPs — across Texas metros, and turn them into verified commercial service opportunities.
- The prospect's first matching lead is usually FREE to claim (premium leads excluded). Claiming takes ~1 minute: open the link, enter the company name plus an email OR mobile number (no email required), and the full sheet unlocks.
- A full job sheet reveals: exact property location, decision-maker contacts, our aerial measurement/sizing, estimated contract value, why the property needs service now, and the window to bid. A ready-to-send intro letter is included.
- If they ask what a sheet looks like or what they'd actually get, send https://greenkeep.us/sample-sheet — a real sold sheet with the identifying details redacted.
- Paid leads are priced by contract value: roughly $39 / $79 / $129 per lead depending on size (exclusive access, which locks out competitors, runs about $99–$299). No subscription required to buy leads.
- Scarcity: a lead is sold to at most ${leadMaxBuyers()} companies in a trade, then it closes. Exclusive purchase closes it immediately.
- First Look (optional subscription) shows members brand-new leads before the public shelf.
- RESIDENTIAL: yes, we sell those too — packages of homeowner addresses carrying a fresh signal (new construction, recently sold), bundled by area for route density. $${Math.round(PACKAGE_MIN_CENTS / 100)}–$${Math.round(PACKAGE_MAX_CENTS / 100)} per package depending on size and signal quality. They live on the buyer dashboard under Residential — creating a free profile (via any claim link) is how to browse them.
- We are a lead marketplace only — we never take a cut of their contract, and their customer data stays theirs.
If asked something outside these facts (refunds, legal, custom deals, pricing exceptions), say Cole will follow up directly.
NOTE: "who are you / where are you based / how did you get my number" are NOT outside these facts — they are answered by the identity block below, and deflecting them reads as evasive to someone deciding whether we are real.`;

/**
 * Who we are, in the prospect's terms. Built from the company row so it cannot
 * drift from what every other surface says.
 *
 * This exists because of a real lost conversation on 2026-07-30: Space City Air
 * Duct Cleaning OPENED their claim link, then asked "Where is your office
 * located?" — twice — and got "Cole will follow up on that directly" both
 * times, because the brief's catch-all treated it as out of scope. A prospect
 * doing basic due-diligence a minute after clicking is the highest-intent
 * moment in the whole funnel, and refusing to say what town you're in is the
 * single worst thing to do at it.
 *
 * Only states what the record actually holds. If there is no street address or
 * phone on file, the AI says the city — it must not invent premises.
 */
export async function companyIdentityBrief(): Promise<string> {
  const co = await getDefaultCompany().catch(() => null);
  if (!co) return "";
  const where = co.city ? `${co.city}, TX${co.zip ? ` ${co.zip}` : ""}` : null;
  const site = (process.env.NEXT_PUBLIC_APP_URL ?? "https://greenkeep.us").replace(/^https?:\/\//, "");
  const lines = [
    `Who we are (answer identity questions directly from this — never deflect these to Cole):`,
    `- ${co.name} (${site}), a lead marketplace, not a contractor. We do not bid on or perform any of the work.`,
    where ? `- Based in ${where}. Say the town plainly if asked where we are.` : null,
    co.service_area_notes ? `- Service area: ${co.service_area_notes}` : null,
    co.email ? `- Reachable at ${co.email}.` : null,
    co.phone ? `- Phone: ${co.phone}.` : null,
    co.booking_url ? `- Anyone who wants a live conversation can book one: ${co.booking_url}` : null,
    `- How we got their number: it is published on their own website or public business listing. We are not a data broker and did not buy their details.`,
    `- If asked for a street address and none is given above, say we run remotely out of ${co.city ?? "the Houston area"} and offer the email or a call — do NOT invent an address.`,
  ].filter(Boolean);
  return lines.join("\n");
}

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
