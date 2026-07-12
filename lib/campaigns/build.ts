// Shared campaign construction — recipient discovery, lead matching, and
// message copy — used by the operator review UI (app/campaigns) and available
// to the eventual fully-automated cron. Apollo is OUR targeting only and never
// ships inside a sold lead; claim links are per-recipient signed tokens.

import { inArray } from "drizzle-orm";
import { db } from "../db";
import { property, type Property } from "../db/schema";
import { getActiveConfig, toEngineConfig, getDefaultCompany } from "../db/queries";
import { sizeLead, type LeadSizing } from "../leads/sizing";
import { searchLandscapers, type BuyerCandidate } from "../integrations/apollo";
import { scrapeBusinessContact } from "../integrations/contact";
import { geocodeAddress } from "../integrations/geocoding";
import { marketForCoords } from "../markets";
import { signBuyerClaim } from "../buyer-auth";
import { haversineMiles } from "../sourcing/criteria";
import type { ParcelResult } from "../geo/types";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const note = (notes: string | null, re: RegExp) => notes?.match(re)?.[1]?.trim() ?? null;

export function baseUrl(): string {
  const b = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return b && !/localhost|127\.0\.0\.1/.test(b) ? b : "https://greenkeep.us";
}

export type SizedLead = {
  id: string;
  city: string | null;
  cost: string;
  workType: string;
  start: string;
  turf: number;
  annualLo: number;
  annualHi: number;
  lat: number;
  lng: number;
};

/** Size the selected properties in-memory (teaser snapshot preferred, else
 *  live sizing) so recipients can be matched to their nearest opportunity. */
export async function sizedLeadsFor(propertyIds: string[]): Promise<SizedLead[]> {
  if (!propertyIds.length) return [];
  const co = await getDefaultCompany();
  const cfgRow = co ? await getActiveConfig(co.id) : null;
  const token = process.env.MAPBOX_API ?? null;
  const rows = await db.select().from(property).where(inArray(property.id, propertyIds));
  const out: SizedLead[] = [];
  for (const p of rows) {
    if (p.lat == null || p.lng == null) continue;
    const teaser = p.lead_teaser as
      | { annual_lo?: number; annual_hi?: number; turf_sqft?: number }
      | null;
    let annualLo = teaser?.annual_lo ?? 0;
    let annualHi = teaser?.annual_hi ?? 0;
    let turf = teaser?.turf_sqft ?? 0;
    if ((!annualLo || !turf) && token && cfgRow && p.parcel_geojson) {
      try {
        const s: LeadSizing = await sizeLead(p.parcel_geojson as ParcelResult, token, toEngineConfig(cfgRow));
        annualLo = s.annual_lo;
        annualHi = s.annual_hi;
        turf = s.turf_sqft;
      } catch {
        /* skip unsizable */
      }
    }
    if (!annualHi) continue;
    out.push({
      id: p.id,
      city: p.city,
      cost: note(p.notes, /est\. cost (\$[\d,]+)/) ?? "large",
      workType: note(p.notes, /TABS \S+: ([^,]+),/) ?? "commercial",
      start: note(p.notes, /Est\. start ([\d-]+)/) ?? "soon",
      turf,
      annualLo,
      annualHi,
      lat: p.lat,
      lng: p.lng,
    });
  }
  return out;
}

export type BuiltRecipient = {
  company_name: string;
  email: string | null;
  website: string | null;
  contact_form_url: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  property_id: string;
  distance_mi: number | null;
  subject: string;
  body: string;
  claim_token: string;
};

/** Honest outreach copy. Never impersonates a customer; leads with the money +
 *  distance, offers the first sheet free via a personal claim link. */
export function buildMessage(o: {
  company: string;
  lead: SizedLead;
  distanceMi: number | null;
  brand: string;
  replyEmail: string;
  price: number;
  cap: number;
  claimUrl: string;
}): { subject: string; body: string } {
  const { lead } = o;
  const mi = o.distanceMi != null ? Math.max(1, Math.round(o.distanceMi)) : null;
  const distShort = mi != null ? `, ${mi} mi from your office` : " near you";
  const distClause = mi != null ? ` about ${mi} ${mi === 1 ? "mile" : "miles"} from your office` : " in your service area";
  const subject = `${usd(lead.annualHi)}/yr grounds contract coming${distShort}`;
  const body = `${o.company} team —

A ${lead.cost} development breaks ground around ${lead.start},${distClause}${lead.city ? ` (${lead.city} area)` : ""}. When it opens, somebody wins the grounds contract.

We measured the site from the air: ~${lead.turf.toLocaleString()} sq ft of maintainable turf. At market rates that's ${usd(lead.annualLo)}–${usd(lead.annualHi)} a year — every year.

Everything a bidder needs is on one page: exact location, the owner and architect to contact, our measurement, crew sizing, and the window to bid. Every job is capped at ${o.cap} companies* — ever — and you can lock one down as an exclusive so nobody else gets it.

Your first sheet is FREE — claim it here (takes 30 seconds, no card):
${o.claimUrl}

The full sheet unlocks the moment you create your profile. After that they're $${o.price} each. Or just reply "SEND IT" and we'll set it up for you.

— ${o.brand}
${o.replyEmail}

P.S. If this one's too far or the wrong size, reply with your service area and we'll send the next match instead.`;
  return { subject, body };
}

/**
 * Build candidate recipients for a campaign: discover companies (existing
 * buyers optional + Apollo), match each to the nearest selected lead, resolve
 * a send channel, and generate the message + claim link. Slow-ish (scrapes),
 * so callers cap `maxBuyers`.
 */
export async function buildRecipients(opts: {
  propertyIds: string[];
  priceUsd: number;
  cap: number;
  maxBuyers?: number;
  location?: string;
  extraBuyers?: BuyerCandidate[];
  excludeCompanyNames?: string[];
}): Promise<BuiltRecipient[]> {
  const leads = await sizedLeadsFor(opts.propertyIds);
  if (!leads.length) return [];
  const co = await getDefaultCompany();
  const brand = co?.name ?? "Greenkeep";
  const replyEmail = co?.email?.trim() || "{YOUR_REPLY_EMAIL}";
  const base = baseUrl();
  const max = opts.maxBuyers ?? 25;

  let buyers: BuyerCandidate[] = [
    ...(opts.extraBuyers ?? []),
    ...(await searchLandscapers(opts.location ?? "Houston, Texas", max)),
  ];
  const exclude = new Set((opts.excludeCompanyNames ?? []).map((n) => n.trim().toLowerCase()));
  const seen = new Set<string>();
  buyers = buyers.filter((b) => {
    const k = b.name.trim().toLowerCase();
    if (!k || exclude.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  buyers = buyers.slice(0, max);

  // Blank candidate state falls back to the campaign's metro (from the first
  // lead's coords), not always Texas — so a stateless office in an FL metro
  // geocodes in Florida.
  const leadState = leads[0] ? marketForCoords(leads[0].lat, leads[0].lng).state ?? "TX" : "TX";
  const out: BuiltRecipient[] = [];
  for (const b of buyers) {
    const officeArea = b.city ? `${b.city}, ${b.state ?? leadState}` : null;
    const coords = officeArea ? await geocodeAddress(officeArea, "place,address,poi") : null;

    let lead = leads[0];
    let dist: number | null = null;
    if (coords) {
      for (const l of leads) {
        const d = haversineMiles([coords[0], coords[1]], [l.lng, l.lat]);
        if (dist === null || d < dist) {
          dist = d;
          lead = l;
        }
      }
    } else {
      lead = [...leads].sort((a, c) => c.annualHi - a.annualHi)[0];
    }

    const contact = b.website
      ? await scrapeBusinessContact(b.website).catch(() => ({ email: null, phone: null, contact_form_url: null }))
      : { email: null, phone: null, contact_form_url: null };

    const claimToken = signBuyerClaim(lead.id, b.name);
    const { subject, body } = buildMessage({
      company: b.name,
      lead,
      distanceMi: dist,
      brand,
      replyEmail,
      price: opts.priceUsd,
      cap: opts.cap,
      claimUrl: `${base}/buyers/claim/${claimToken}`,
    });

    out.push({
      company_name: b.name,
      email: contact.email,
      website: b.website,
      contact_form_url: contact.contact_form_url,
      city: officeArea,
      lat: coords?.[1] ?? null,
      lng: coords?.[0] ?? null,
      property_id: lead.id,
      distance_mi: dist,
      subject,
      body,
      claim_token: claimToken,
    });
  }
  return out;
}

export type CampaignProperty = {
  p: Property;
  annualLo: number | null;
  annualHi: number | null;
  spotsLeft: number;
};
