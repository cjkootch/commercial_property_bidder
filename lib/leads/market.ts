// The open marketplace shelf, computed in ONE place so the buyer dashboard,
// the free-claim actions, and the operator's offer blast all agree on what's
// sellable, what's left, and what may go free. Covers every sourcing feed:
// TABS (construction), HCAD (ownership transfer), STP (business opening).

import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { buyer, leadUnlock, property, suppression, type Property } from "../db/schema";

type Buyer = typeof buyer.$inferSelect;
import { leadMaxBuyers } from "./availability";
import {
  daysSince,
  evaluateFreeClaim,
  leadRank,
  type FreeClaimContext,
  type FreeClaimVerdict,
} from "./allocation";
import {
  estimateCompletionFromNotes,
  haversineMiles,
  monthsUntil,
} from "../sourcing/criteria";

export type LeadKind = "construction" | "transfer" | "opening" | "violation";

export function leadKind(name: string): LeadKind {
  if (/\(HCAD [^)]+\)$/.test(name)) return "transfer";
  if (/\(STP [^)]+\)$/.test(name)) return "opening";
  if (/\(H311 [^)]+\)$/.test(name)) return "violation";
  return "construction";
}

/** Strip the sourcing ref from a property name for buyer-facing display. */
export function displayName(name: string): string {
  return name.replace(/ \((TABS|HCAD|STP|H311) [^)]+\)$/, "");
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
export async function loadMarketLeads(): Promise<MarketLead[]> {
  const cap = leadMaxBuyers();
  const props = await db.select().from(property).orderBy(desc(property.created_at));
  const unlocks = await db
    .select({ pid: leadUnlock.property_id, bid: leadUnlock.buyer_id, kind: leadUnlock.kind })
    .from(leadUnlock);
  const byProp = new Map<string, { count: number; free: number; exclusive: boolean; holders: Set<string> }>();
  for (const u of unlocks) {
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
        /\((TABS|HCAD|STP|H311) [^)]+\)$/.test(p.name) &&
        p.archived_at == null &&
        p.lead_exported_at == null &&
        p.parcel_geojson != null &&
        !byProp.get(p.id)?.exclusive &&
        (byProp.get(p.id)?.count ?? 0) < cap
    )
    .map((p) => {
      const e = byProp.get(p.id);
      const teaser = p.lead_teaser as Teaser;
      const monthsToCompletion = monthsUntil(estimateCompletionFromNotes(p.notes)?.iso ?? null);
      return {
        p,
        kind: leadKind(p.name),
        teaser,
        spotsLeft: cap - (e?.count ?? 0),
        exclusiveOpen: (e?.count ?? 0) === 0,
        freeUnlocksOnLead: e?.free ?? 0,
        holders: e?.holders ?? new Set<string>(),
        ageDays: daysSince(p.created_at),
        monthsToCompletion,
        rank: leadRank(teaser?.annual_hi ?? null, monthsToCompletion),
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
