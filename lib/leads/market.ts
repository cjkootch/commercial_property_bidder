// The open marketplace shelf, computed in ONE place so the buyer dashboard,
// the free-claim actions, and the operator's offer blast all agree on what's
// sellable, what's left, and what may go free. Covers every sourcing feed:
// TABS (construction), HCAD (ownership transfer), STP/TABC (business opening),
// H311 (citation), TAX (tax-sale distress), RFP (public bid).

import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { buyer, leadUnlock, property, suppression, type Property } from "../db/schema";

type Buyer = typeof buyer.$inferSelect;
import { leadMaxBuyers } from "./availability";
import {
  daysSince,
  evaluateFreeClaim,
  type FreeClaimContext,
  type FreeClaimVerdict,
} from "./allocation";
import { DEFAULT_TRADE, TRADES, type Trade } from "./trades";
import {
  estimateCompletionFromNotes,
  haversineMiles,
  monthsUntil,
} from "../sourcing/criteria";

export type LeadKind = "construction" | "transfer" | "opening" | "violation" | "distress" | "rfp";

export function leadKind(name: string): LeadKind {
  if (/\(HCAD [^)]+\)$/.test(name)) return "transfer";
  if (/\((STP|TABC) [^)]+\)$/.test(name)) return "opening";
  if (/\(H311 [^)]+\)$/.test(name)) return "violation";
  if (/\(TAX [^)]+\)$/.test(name)) return "distress";
  if (/\(RFP [^)]+\)$/.test(name)) return "rfp";
  return "construction";
}

/** Strip the sourcing ref from a property name for buyer-facing display. */
export function displayName(name: string): string {
  return name.replace(/ \((TABS|HCAD|STP|H311|TABC|TAX|RFP) [^)]+\)$/, "");
}

export type Teaser = { annual_lo?: number; annual_hi?: number; turf_sqft?: number } | null;

export type MarketLead = {
  p: Property;
  kind: LeadKind;
  teaser: Teaser;
  spotsLeft: number;
  exclusiveOpen: boolean;
  freeUnlocksOnLead: number;
  /** Buyer ids already holding this lead. */
  holders: Set<string>;
  ageDays: number;
  /** Signed months to completion/opening from the notes (null = no timeline). */
  monthsToCompletion: number | null;
  /** Universal quality rank: value x bid-window openness. NO buyer factors. */
  rank: number;
};

/**
 * Every lead currently on the shelf: pipeline-sourced (has a feed ref in the
 * name), sellable (parcel present), in circulation (not archived/exported/
 * exclusive-sold), with at least one shared spot open.
 */
export async function loadMarketLeads(trade: Trade = DEFAULT_TRADE): Promise<MarketLead[]> {
  const cap = leadMaxBuyers();
  const tradeDef = TRADES[trade];
  const props = await db.select().from(property).orderBy(desc(property.created_at));
  // Spots, exclusives, and the free budget all count WITHIN the trade: a
  // pest exclusive never closes the landscaping shelf and vice versa.
  const unlocks = await db
    .select({ pid: leadUnlock.property_id, bid: leadUnlock.buyer_id, kind: leadUnlock.kind, trade: leadUnlock.trade })
    .from(leadUnlock);
  const byProp = new Map<string, { count: number; free: number; exclusive: boolean; holders: Set<string> }>();
  for (const u of unlocks) {
    if (u.trade !== trade) continue;
    const e = byProp.get(u.pid) ?? { count: 0, free: 0, exclusive: false, holders: new Set<string>() };
    e.count++;
    if (u.kind === "free") e.free++;
    if (u.kind === "exclusive") e.exclusive = true;
    e.holders.add(u.bid);
    byProp.set(u.pid, e);
  }

  return props
    .filter(
      (p) =>
        /\((TABS|HCAD|STP|H311|TABC|TAX|RFP) [^)]+\)$/.test(p.name) &&
        tradeDef.relevant(leadKind(p.name)) &&
        (tradeDef.sellable?.(p.lead_teaser as { turf_sqft?: number; verified?: boolean } | null) ?? true) &&
        p.archived_at == null &&
        p.lead_exported_at == null &&
        // Public-bid (RFP) leads have no parcel — the solicitation IS the
        // deliverable. Every property lead still requires one.
        (p.parcel_geojson != null || leadKind(p.name) === "rfp") &&
        !byProp.get(p.id)?.exclusive &&
        (byProp.get(p.id)?.count ?? 0) < cap
    )
    .map((p) => {
      const e = byProp.get(p.id);
      const teaser = p.lead_teaser as Teaser;
      const kind = leadKind(p.name);
      // Public bids: the deadline is the timeline ("Bids close YYYY-MM-DD").
      const closesIso = kind === "rfp" ? p.notes?.match(/Bids close ([\d-]+)/)?.[1] ?? null : null;
      const monthsToCompletion =
        kind === "rfp"
          ? monthsUntil(closesIso)
          : monthsUntil(estimateCompletionFromNotes(p.notes)?.iso ?? null);
      // A FRESH citation is an open decision window — the owner must hire
      // someone now. Stale citations (~45d+) mean resolved or ignored.
      const citedIso = kind === "violation" ? p.notes?.match(/311 case \S+ \(([\d-]+)\)/)?.[1] : null;
      // A scheduled tax auction inside ~60 days is the same forced window.
      const auctionIso = kind === "distress" ? p.notes?.match(/Tax sale scheduled ([\d-]+)/)?.[1] : null;
      const urgent =
        (citedIso != null && Date.now() - new Date(citedIso).getTime() < 45 * 86400_000) ||
        (auctionIso != null &&
          new Date(auctionIso).getTime() - Date.now() < 60 * 86400_000 &&
          new Date(auctionIso).getTime() - Date.now() > -30 * 86400_000) ||
        // An open bid window on a public contract is urgent by definition.
        (kind === "rfp" && closesIso != null && closesIso >= new Date().toISOString().slice(0, 10));
      return {
        p,
        kind,
        teaser,
        spotsLeft: cap - (e?.count ?? 0),
        exclusiveOpen: (e?.count ?? 0) === 0,
        freeUnlocksOnLead: e?.free ?? 0,
        holders: e?.holders ?? new Set<string>(),
        ageDays: daysSince(p.created_at),
        monthsToCompletion,
        rank: tradeDef.rank({
          kind,
          annualHi: teaser?.annual_hi ?? null,
          monthsToCompletion,
          urgent,
          icpType: p.icp_type,
          notes: p.notes,
        }),
      };
    });
}

/** Marketplace-wide inputs for the free-claim policy. */
export function marketFreeContext(leads: MarketLead[]): FreeClaimContext {
  return {
    openValues: leads.map((l) => l.teaser?.annual_hi ?? 0),
    openSpots: leads.reduce((s, l) => s + l.spotsLeft, 0),
  };
}

export function freeVerdict(lead: MarketLead, ctx: FreeClaimContext): FreeClaimVerdict {
  return evaluateFreeClaim(
    {
      annualHi: lead.teaser?.annual_hi ?? null,
      ageDays: lead.ageDays,
      freeUnlocksOnLead: lead.freeUnlocksOnLead,
      spotsLeft: lead.spotsLeft,
    },
    ctx
  );
}

/**
 * The waterfall fallback: the best open lead for a buyer. Radius decides
 * ELIGIBILITY (within their service radius + the standard cushion); the
 * universal quality rank decides ORDER — distance never makes a lead "better".
 */
export function nextBestFor(
  leads: MarketLead[],
  buyer: { id: string; lat: number | null; lng: number | null; service_radius_mi: number },
  excludeIds: string[] = []
): (MarketLead & { miles: number | null }) | null {
  const reach = buyer.service_radius_mi + Math.max(15, Math.round(buyer.service_radius_mi * 0.4));
  const skip = new Set(excludeIds);
  const ranked = leads
    .filter((l) => !skip.has(l.p.id) && !l.holders.has(buyer.id))
    .map((l) => ({
      ...l,
      miles:
        buyer.lat != null && buyer.lng != null && l.p.lat != null && l.p.lng != null
          ? Math.max(1, Math.round(haversineMiles([buyer.lng, buyer.lat], [l.p.lng, l.p.lat])))
          : null,
    }))
    .filter((l) => l.miles == null || l.miles <= reach)
    .sort((a, b) => b.rank - a.rank);
  return ranked[0] ?? null;
}

/** How many companies an offer blast reaches at most. */
export const OFFER_MAX_RECIPIENTS = 30;

/**
 * Who gets the offer email for a lead: opted-in, not suppressed, not already
 * holding it, and the lead is within their service radius (+ the standard
 * cushion) — nearest first. Buyers with no office location rank last but stay
 * in (we can't rule them out).
 */
export async function offerRecipients(
  prop: Property,
  max: number = OFFER_MAX_RECIPIENTS
): Promise<{ b: Buyer; miles: number | null }[]> {
  const buyers = await db.select().from(buyer).where(eq(buyer.notify, true));
  const suppressed = new Set(
    (await db.select({ email: suppression.email }).from(suppression)).map((r) => r.email)
  );
  const holders = new Set(
    (
      await db
        .select({ bid: leadUnlock.buyer_id })
        .from(leadUnlock)
        .where(eq(leadUnlock.property_id, prop.id))
    ).map((r) => r.bid)
  );
  return buyers
    .filter((b) => !suppressed.has(b.email) && !holders.has(b.id))
    .map((b) => ({
      b,
      miles:
        b.lat != null && b.lng != null && prop.lat != null && prop.lng != null
          ? haversineMiles([b.lng, b.lat], [prop.lng, prop.lat])
          : null,
    }))
    .filter(({ b, miles }) => {
      if (miles == null) return true;
      const reach = b.service_radius_mi + Math.max(15, Math.round(b.service_radius_mi * 0.4));
      return miles <= reach;
    })
    .sort((a, z) => (a.miles ?? 999) - (z.miles ?? 999))
    .slice(0, max);
}
