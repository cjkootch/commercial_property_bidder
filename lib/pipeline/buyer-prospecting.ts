// Automated buyer prospecting: when a fresh lead lands on the shelf, find the
// ~30 OUTSIDE landscaping companies (no Greenkeep account yet — account
// holders get the in-app offer blast instead) most likely to buy it, qualify
// each against THEIR criteria, and queue a personalized "first sheet free"
// email with a claim link. Shared by the CLI (scripts/prospect-buyers) and the
// weekly cron (/api/cron/prospecting).
//
// Qualification, per company (all snapshots stored on buyer_outreach):
//   1. Not an existing buyer account (they see offers in the app).
//   2. Not contacted in the last COOLDOWN_DAYS, and never for this property.
//   3. Geographic coverage: office geocodes within MAX_DISTANCE_MI of the lead.
//   4. Commercial signal: homepage mentions commercial/HOA/property-management
//      work (residential-only shops don't buy commercial leads). Soft — ranks
//      first rather than gates, since many small sites say little.
//   5. A deliverable channel: a published email is REQUIRED for automation
//      (companies with only a contact form land in the queue as `skipped` so
//      the operator can paste manually — the campaign-kit flow).
//
// Sending: rows are queued; they actually send only when PROSPECTING_AUTOSEND=1
// (setting that env var IS the standing operator approval, spec §9) or the CLI
// passes --send. Every send checks the suppression list and carries one-click
// unsubscribe headers. Apollo data is for our own targeting only — it never
// ships inside a sold lead.

import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { marketForCoords } from "../markets";
import { searchLandscapersDeep, type BuyerCandidate } from "../integrations/apollo";
import {
  asTrade,
  DEFAULT_TRADE,
  TRADES,
  tradeValueInput,
  type Trade,
  type TradeValueEstimate,
} from "../leads/trades";
import { scrapeBusinessContact } from "../integrations/contact";
import { geocodeAddress } from "../integrations/geocoding";
import { upsertProspectCompany } from "../leads/companies";
import { sendEmail } from "../integrations/resend";
import { signBuyerClaim, signBuyerUnsub } from "../buyer-auth";
import { leadMaxBuyers } from "../leads/availability";
import { haversineMiles } from "../sourcing/criteria";
import { loadMarketLeads, type LeadKind, type MarketLead } from "../leads/market";
import { leadTierFor } from "../leads/pricing-tiers";
import { ensurePropertyAttom, usdShort, type AttomFacts } from "../integrations/attom";

/** Don't email a NEWLY DISCOVERED company again within this window. Known
 *  contacts (past recipients) instead follow the area-alert cadence below. */
export const COOLDOWN_DAYS = 30;
/** Area alerts: a known contact can be offered a NEW lead near them after
 *  this many days since their last email — max ~1 email/week, and only ever
 *  because a genuinely new job appeared in their radius. */
export const ALERT_COOLDOWN_DAYS = 7;
/** Stop emailing a known contact after this many TRACKED sends (rows with a
 *  Resend message id) with zero opens or clicks — dead inboxes fall off the
 *  list instead of dragging deliverability down. Untracked sends (before the
 *  funnel shipped) don't count: we can't know whether they were read. */
export const ALERT_MAX_UNOPENED = 3;
/** A company's office must be within this range of the lead. */
export const MAX_DISTANCE_MI = 40;
/** Target list size per lead. */
export const WANT_COMPANIES = 30;
/** Candidate pool to qualify from (Apollo page size). */
const CANDIDATE_POOL = 100;

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const companyKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/** Is auto-send armed? The env var is the standing operator approval. */
export function autosendEnabled(): boolean {
  return process.env.PROSPECTING_AUTOSEND === "1" || process.env.PROSPECTING_AUTOSEND === "true";
}

/** Homepage mentions commercial-type work? Null when the site can't be read. */
export async function looksCommercial(website: string | null): Promise<boolean | null> {
  if (!website) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(website, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GreenkeepBot/1.0)" },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 200_000);
    return /commercial|HOA|property\s*manage|office\s*park|retail\s*center|industrial|municipal/i.test(html);
  } catch {
    return null;
  }
}


/** Does the site's homepage read like a company IN this trade? */
export async function siteMatchesVendor(website: string, re: RegExp): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(website, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GreenkeepBot/1.0)" },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return false;
    return re.test((await res.text()).slice(0, 200_000));
  } catch {
    return false;
  }
}

// --- area alerts: re-offer NEW leads to known contacts ----------------------

/** The buyer_outreach columns the selector reads (newest row first). */
export type KnownContactRow = {
  company_key: string;
  company_name: string;
  property_id: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  contact_form_url: string | null;
  office_city: string | null;
  office_lat: number | null;
  office_lng: number | null;
  commercial_signal: boolean | null;
  status: string;
  sent_at: Date | null;
  resend_message_id: string | null;
  opened_at: Date | null;
  clicked_at: Date | null;
  /** Which campaign trade this row was (parsed from its claim link). */
  claim_url: string | null;
};

/** The trade a past outreach row pitched — from its claim link. Rows without
 *  one (operator direct replies) belong to no campaign trade. */
export function rowTrade(claimUrl: string | null): Trade | null {
  const m = claimUrl?.match(/[?&]trade=([a-z]+)/)?.[1];
  return m ? asTrade(m) : null;
}

export type KnownContact = {
  key: string;
  name: string;
  website: string | null;
  email: string;
  phone: string | null;
  form: string | null;
  city: string | null;
  /** [lng, lat] of the office, from the original qualification. */
  coords: [number, number];
  /** Miles from THIS lead (recomputed — the stored one was for the old lead). */
  distance: number;
  commercial: boolean | null;
};

/** Past campaign recipients eligible for a "new lead near you" offer. Pure
 *  over fetched rows (newest first) so the guardrails are unit-testable:
 *  never the same lead twice, never bounced, ≥ALERT_COOLDOWN_DAYS since the
 *  last email, not ALERT_MAX_UNOPENED tracked sends with zero engagement,
 *  and the office inside MAX_DISTANCE_MI of the new lead. Account and
 *  suppression checks stay with the caller (they need other tables). */
export function selectKnownContacts(
  rows: KnownContactRow[],
  lead: { id: string; lat: number; lng: number },
  now: Date = new Date(),
  /** LEAD INTEGRITY: only companies known from THIS trade's campaigns get the
   *  alert — a pest company must never be offered a landscaping lead. Omitted
   *  = legacy behavior (tests); every caller passes the run's trade. */
  trade?: Trade
): KnownContact[] {
  const byKey = new Map<string, KnownContactRow[]>();
  for (const r of rows) {
    const g = byKey.get(r.company_key);
    if (g) g.push(r);
    else byKey.set(r.company_key, [r]);
  }

  const out: KnownContact[] = [];
  for (const [key, group] of byKey) {
    // A company is "known" for a trade only through that trade's campaigns —
    // a pest company must never be alerted about a landscaping lead. The
    // frequency/engagement caps below still span ALL trades (politeness is
    // global; qualification is per-trade).
    if (trade && !group.some((r) => rowTrade(r.claim_url) === trade)) continue;
    if (group.some((r) => r.property_id === lead.id)) continue; // already offered this lead
    if (group.some((r) => r.status === "bounced")) continue; // dead address
    const latest = group.find((r) => r.email);
    if (!latest?.email) continue; // forms-only companies stay manual

    // Frequency cap across ALL campaigns: at most one email per window.
    const lastSent = group.reduce<Date | null>(
      (m, r) => (r.sent_at && (!m || r.sent_at > m) ? r.sent_at : m),
      null
    );
    if (!lastSent) continue; // never actually emailed — let discovery requalify them
    // 12h grace: the weekly cron drifts by processing order — an exact 7-day
    // gate flapped contacts to biweekly when this Monday ran minutes early.
    if (now.getTime() - lastSent.getTime() < ALERT_COOLDOWN_DAYS * 86400_000 - 12 * 3600_000)
      continue;

    // Engagement gate: tracked sends that all went unread = stop emailing.
    // Only CAMPAIGN sends count toward the engagement gate — operator 1:1
    // replies carry a message id too but say nothing about campaign fatigue.
    const tracked = group.filter((r) => r.resend_message_id && r.claim_url);
    if (
      tracked.length >= ALERT_MAX_UNOPENED &&
      !tracked.some((r) => r.opened_at || r.clicked_at)
    )
      continue;

    const office = group.find((r) => r.office_lat != null && r.office_lng != null);
    if (!office) continue; // no coords on record — rediscovery will re-geocode
    const coords: [number, number] = [office.office_lng!, office.office_lat!];
    const distance = haversineMiles(coords, [lead.lng, lead.lat]);
    if (distance > MAX_DISTANCE_MI) continue;

    out.push({
      key,
      name: latest.company_name,
      website: latest.website,
      email: latest.email,
      phone: latest.phone,
      form: latest.contact_form_url,
      city: latest.office_city,
      coords,
      distance,
      commercial: group.find((r) => r.commercial_signal != null)?.commercial_signal ?? null,
    });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

/** The teaser numbers used to personalize the pitch (no imagery spend). */
type LeadPitch = {
  id: string;
  kind: LeadKind;
  city: string | null;
  lat: number;
  lng: number;
  annualLo: number;
  annualHi: number;
  turf: number | null;
  /** Pipeline notes — the memo quotes real dates out of them. */
  notes: string | null;
  spotsLeft: number;
  /** Operator hand-measured — the memo says so; it sells. */
  verified: boolean;
  /** THIS trade's contract-value estimate (landscaping = the teaser; other
   *  trades price off county records). Null = no honest number to quote. */
  value: TradeValueEstimate | null;
  /** ATTOM assessor facts, enriched at offer time (one metered call per
   *  property, ever) — powers the memo's PROPERTY line. */
  facts?: AttomFacts | null;
};

export function toPitch(l: MarketLead, trade: Trade = DEFAULT_TRADE): LeadPitch | null {
  const t = l.teaser;
  if (!t?.annual_lo || !t.annual_hi || l.p.lat == null || l.p.lng == null) return null;
  return {
    id: l.p.id,
    kind: l.kind,
    city: l.p.city,
    lat: l.p.lat,
    lng: l.p.lng,
    annualLo: t.annual_lo,
    annualHi: t.annual_hi,
    turf: t.turf_sqft ?? null,
    notes: l.p.notes,
    spotsLeft: l.spotsLeft,
    verified: (t as { verified?: boolean }).verified ?? false,
    value: TRADES[trade].estimateValue(tradeValueInput(l.p, l.kind)),
  };
}

/** The outreach email as a LEAD HANDOFF, not a platform pitch: the specifics
 *  up top (trigger with the real date, size, value, spots left), the claim
 *  link for the rest, and who-we-are in two honest sentences at the bottom.
 *  Everything quoted is teaser-safe — the address and owner stay behind the
 *  claim. Honest: says exactly what we are; never impersonates a customer. */
export function buildProspectMessage(o: {
  company: string;
  lead: LeadPitch;
  distanceMi: number | null;
  brand: string;
  replyEmail: string;
  price: number;
  cap: number;
  claimUrl: string;
  /** Buyer vertical the pitch speaks to (default landscaping). */
  trade?: Trade;
  /** Subject A/B (launch analysis: ~40% of openers click — the subject is the
   *  funnel bottleneck). A = long value-led (the original). B = short, local,
   *  human. Assigned alternately at queue time; measured via /campaigns. */
  subjectVariant?: "A" | "B";
}): { subject: string; body: string } {
  const { lead } = o;
  const trade = o.trade ?? DEFAULT_TRADE;
  const note = (re: RegExp) => lead.notes?.match(re)?.[1] ?? null;
  const mi = o.distanceMi != null ? Math.max(1, Math.round(o.distanceMi)) : null;

  // The TRIGGER line: why this owner is deciding now, with the real date.
  const saleDate = note(/HCAD transfer ([\d-]+)/);
  const opensDate = note(/Opens ([\d-]+)/);
  const citedDate = note(/311 case \S+ \(([\d-]+)\)/);
  const auctionDate = note(/Tax sale scheduled ([\d-]+)/);
  const startDate = note(/Est\. start ([\d-]+)/);
  const trigger =
    lead.kind === "transfer"
      ? `Property changed owners${saleDate ? ` on ${saleDate}` : " recently"} — new owners re-bid their vendors in the first year`
      : lead.kind === "opening"
        ? `New business opening${opensDate ? ` around ${opensDate}` : " soon"} — the property's vendor decisions are being made now`
        : lead.kind === "violation"
          ? `Cited by the city${citedDate ? ` on ${citedDate}` : ""} — the owner is required to arrange service immediately`
          : lead.kind === "distress"
            ? auctionDate
              ? `County tax sale scheduled ${auctionDate} — cleanup needed now, and the next owner re-bids every vendor`
              : `In the county tax-sale pipeline — cleanup needed now, and the next owner re-bids every vendor`
            : lead.kind === "rfp"
              ? `Government grounds contract out for bid — hard deadline`
              : `New construction${startDate ? `, breaks ground around ${startDate}` : ""} — the first contract hasn't been won by anyone`;

  const kindShort =
    lead.kind === "transfer"
      ? "new owner"
      : lead.kind === "opening"
        ? "business opening"
        : lead.kind === "violation"
          ? "city citation"
          : lead.kind === "distress"
            ? "tax-sale property"
            : lead.kind === "rfp"
              ? "public bid"
              : "new construction";

  // The landscaping memo quotes our measured value; other trades quote THEIR
  // OWN estimate (county-records value model) and never borrow the turf
  // number — a pest company doesn't care about grass, and quoting a
  // landscaping figure would read as exactly the spam it isn't.
  const est = lead.value;
  const serviceNoun = trade === "landscaping" ? "grounds care" : TRADES[trade].service;
  const subject =
    o.subjectVariant === "B"
      ? `A ${kindShort} near you needs ${serviceNoun}${lead.city ? ` — ${lead.city}` : ""}`
      : trade === "landscaping"
        ? `Grounds contract lead — ${kindShort}${lead.city ? `, ${lead.city} area` : ""} — est. ${usd(lead.annualLo)}–${usd(lead.annualHi)}/yr`
        : `Commercial ${TRADES[trade].service} lead — ${kindShort}${lead.city ? `, ${lead.city} area` : ""}${est ? ` — est. ${usd(est.annualLo)}–${usd(est.annualHi)}${est.per === "project" ? " project" : "/yr"}` : ""}`;

  const valueRows =
    trade === "landscaping"
      ? `${lead.turf ? `GROUNDS — ~${Math.round(lead.turf).toLocaleString()} sq ft of maintainable turf, ${lead.verified ? "hand-verified measurement" : "measured from the air"}\n` : ""}EST. VALUE — ${usd(lead.annualLo)}–${usd(lead.annualHi)}/yr at market rates, recurring`
      : est
        ? `SCOPE — ${est.basis}\nEST. VALUE — ${usd(est.annualLo)}–${usd(est.annualHi)}${est.per === "project" ? " project, at market rates" : "/yr at market rates, recurring"}`
        : TRADES[trade].sells === "project"
          ? `PROJECT — ${TRADES[trade].service} work, vendor decision in motion`
          : `CONTRACT — year-round ${TRADES[trade].service} contract, vendor decision in motion`;

  // The PROPERTY line (ATTOM assessor facts, when enriched): the stakes in
  // county numbers — reads as insider knowledge because it is.
  const f = lead.facts && lead.facts.status === "ok" ? lead.facts : null;
  const factBits = f
    ? [
        usdShort(f.market_value ?? f.assessed_value)
          ? `county-valued at ${usdShort(f.market_value ?? f.assessed_value)}`
          : null,
        f.building_sqft ? `${Math.round(f.building_sqft).toLocaleString()} sq ft building` : null,
        f.absentee === true ? "absentee owner (decisions made off-site)" : null,
      ].filter(Boolean)
    : [];
  const propertyRow = factBits.length ? `PROPERTY — ${factBits.join(", ")}\n` : "";

  const body = `${o.company} team —

A lead for you. No charge on this one, no obligation — but a heads-up before the details: we only ever sell a job to ${o.cap} companies, and this one is live right now.

AREA — ${lead.city ?? "Houston"}${mi != null ? `, about ${mi} ${mi === 1 ? "mile" : "miles"} from your office` : ""}
TRIGGER — ${trigger}
${propertyRow}${valueRows}
STATUS — ${lead.spotsLeft} of ${o.cap} spots left — when they're gone, this job closes for good

The full sheet has the exact address, the owner and their mailing address, our aerial measurement, and a ready-to-send intro letter:

${o.claimUrl}
(30 seconds, no card)

We're ${o.brand} — we find commercial properties at the moment vendors get chosen and hand the research to local companies. This first one is on us. After that, sheets run $39-$129 depending on contract size (this one is $${o.price}), and every job is capped at ${o.cap} companies* — or lock one down as an exclusive so nobody else gets it.

Reply with your service area if this one's wrong for you — we'll send the next match instead.

— ${o.brand}
${o.replyEmail}

* The cap applies per service trade — full terms: ${siteBase()}/terms`;
  return { subject, body };
}

/** Message text -> simple branded HTML with the compliance footer. */
export function toHtml(body: string, unsubUrl: string, physicalAddress: string | null): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paras = body
    .split(/\n\n+/)
    .map((p) => {
      const escaped = esc(p).replace(
        /(https?:\/\/[^\s]+)/g,
        (u) => `<a href="${u}" style="color:#2f7d4f;font-weight:600;">${u}</a>`
      );
      return `<p style="margin:0 0 14px;">${escaped.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
  return (
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;line-height:1.55;">` +
    paras +
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">` +
    `<p style="color:#9ca3af;font-size:11px;margin:0;">` +
    (physicalAddress ? `${esc(physicalAddress)} · ` : "") +
    `<a href="${unsubUrl}" style="color:#9ca3af;">Unsubscribe</a></p></div>`
  );
}

export function siteBase(): string {
  const b = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return b && !/localhost|127\.0\.0\.1/.test(b) ? b : "https://greenkeep.us";
}

export type ProspectingRunSummary = {
  lead: string | null;
  candidates: number;
  qualified: number;
  queued: number;
  sent: number;
  skippedNoEmail: number;
  log: string[];
};

export async function runBuyerProspecting(opts?: {
  /** Target lead; omitted = best fresh uncampaigned lead on the shelf. */
  propertyId?: string;
  /** Buyer vertical to prospect for (default landscaping): picks the trade's
   *  shelf/ranking, its Apollo keywords, and its pitch copy. */
  trade?: Trade;
  want?: number;
  /** Force-send this run regardless of PROSPECTING_AUTOSEND (CLI --send). */
  send?: boolean;
  /** Report what WOULD happen — no rows written, nothing sent (the cron's
   *  mode while automation is off, so unattended runs have zero side effects). */
  dryRun?: boolean;
  /** Candidate source override (tests / campaign CSV); default Apollo. */
  candidates?: BuyerCandidate[];
  /** Operator prune list: normalized name fragments to drop from the run
   *  (cron ?exclude=cetane,sawin) — the human eyeball is the final gate. */
  excludeKeys?: string[];
}): Promise<ProspectingRunSummary> {
  const want = opts?.want ?? WANT_COMPANIES;
  const trade = opts?.trade ?? DEFAULT_TRADE;
  const doSend = opts?.send ?? autosendEnabled();
  const log: string[] = [];
  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found. Run `npm run db:seed` first.");
  const replyEmail = co.email?.trim() || "";
  

  // ---- 1. The lead: requested, or best fresh uncampaigned one on the shelf.
  const market = await loadMarketLeads(trade);
  let lead: LeadPitch | null = null;
  if (opts?.propertyId) {
    const l = market.find((m) => m.p.id === opts.propertyId);
    lead = l ? toPitch(l, trade) : null;
    if (!lead) {
      log.push("Requested property is not an open, teaser-priced lead — nothing to offer.");
      return { lead: null, candidates: 0, qualified: 0, queued: 0, sent: 0, skippedNoEmail: 0, log };
    }
  } else {
    // "Campaigned" is per TRADE: a property blasted to pest is still fresh
    // inventory for the landscaping auto-pick (each trade has its own spots).
    const campaigned = new Set(
      (
        await db
          .select({
            pid: schema.buyerOutreach.property_id,
            claim_url: schema.buyerOutreach.claim_url,
          })
          .from(schema.buyerOutreach)
      )
        .filter((r) => r.pid && rowTrade(r.claim_url) === trade)
        .map((r) => r.pid) as string[]
    );
    const fresh = market
      .filter((l) => !campaigned.has(l.p.id) && l.ageDays <= 14)
      .map((l) => ({ l, pitch: toPitch(l, trade) }))
      .filter((x) => x.pitch)
      // Universal quality rank (value x bid-window) — same order buyers see.
      .sort((a, b) => b.l.rank - a.l.rank);
    lead = fresh[0]?.pitch ?? null;
    if (!lead) {
      log.push("No fresh uncampaigned leads on the shelf — nothing to do.");
      return { lead: null, candidates: 0, qualified: 0, queued: 0, sent: 0, skippedNoEmail: 0, log };
    }
  }
  // Offer-time ATTOM enrichment: ONE metered call for the single property this
  // whole campaign pitches (cached forever) — the memo and every later nudge
  // for this lead get the county valuation + building size to sell with.
  const chosenRow = market.find((m) => m.p.id === lead!.id)?.p;
  lead.facts = chosenRow ? await ensurePropertyAttom(chosenRow).catch(() => null) : null;
  log.push(
    `Lead: ${lead.city ?? "?"} ${lead.kind}, ${usd(lead.annualLo)}–${usd(lead.annualHi)}/yr (${lead.id.slice(0, 8)})${lead.facts ? ` · ATTOM ${usdShort(lead.facts.market_value ?? lead.facts.assessed_value) ?? "facts"}` : ""}`
  );

  // ---- 2. Exclusions: existing accounts + cooldown + already-offered-this-lead.
  const existingBuyers = await db.select({ name: schema.buyer.company_name }).from(schema.buyer);
  const accountKeys = new Set(existingBuyers.map((b) => companyKey(b.name)));
  // The company graph carries operator verdicts and enrichment for every
  // company we've pitched: blocked profiles never get another email from ANY
  // path (discovery or area alert); buyer-linked profiles are accounts even
  // when the signup name was spelled differently than the pitched name; and
  // graph emails (Apollo enrichment) back-fill companies whose sites hide
  // their address from the scraper.
  const graphProfiles = await db
    .select({
      key: schema.prospectCompany.key,
      email: schema.prospectCompany.email,
      blocked_at: schema.prospectCompany.blocked_at,
      buyer_id: schema.prospectCompany.buyer_id,
    })
    .from(schema.prospectCompany);
  const blockedKeys = new Set(graphProfiles.filter((p) => p.blocked_at).map((p) => p.key));
  for (const p of graphProfiles) if (p.buyer_id) accountKeys.add(p.key);
  const graphEmail = new Map(
    graphProfiles.filter((p) => p.email).map((p) => [p.key, p.email as string])
  );
  // Cooldown counts only ACTUAL contact (sent) — queued/skipped rows are
  // records, not touches, and must not block a company for 30 days.
  const since = new Date(Date.now() - COOLDOWN_DAYS * 86400_000);
  const recent = await db
    .select({ key: schema.buyerOutreach.company_key, email: schema.buyerOutreach.email })
    .from(schema.buyerOutreach)
    .where(and(gte(schema.buyerOutreach.created_at, since), eq(schema.buyerOutreach.status, "sent")));
  const cooled = new Set(recent.map((r) => r.key));
  // Cooldown by EMAIL too (2026-07-17 audit): company_key is a normalized
  // NAME, and Apollo surfaces the same shop under multiple spellings ("ABC
  // Lawn" / "ABC Lawn Care LLC") — name-only cooldown let the same inbox get
  // a commercial and a residential cold email the same day. Both engines
  // share buyer_outreach, so this closes the gap across products.
  const cooledEmails = new Set(
    recent.map((r) => r.email?.toLowerCase()).filter(Boolean) as string[]
  );
  const offeredRows = await db
    .select({ key: schema.buyerOutreach.company_key, email: schema.buyerOutreach.email })
    .from(schema.buyerOutreach)
    .where(eq(schema.buyerOutreach.property_id, lead.id));
  const offeredThis = new Set(offeredRows.map((r) => r.key));
  const offeredEmails = new Set(
    offeredRows.map((r) => r.email?.toLowerCase()).filter(Boolean) as string[]
  );

  const suppressed = new Set(
    (await db.select({ email: schema.suppression.email }).from(schema.suppression)).map((r) =>
      r.email.toLowerCase()
    )
  );

  type Qualified = {
    c: BuyerCandidate;
    key: string;
    coords: [number, number] | null;
    distance: number | null;
    commercial: boolean | null;
    email: string | null;
    phone: string | null;
    form: string | null;
  };
  const qualified: Qualified[] = [];
  let skippedNoEmail = 0;

  // ---- 3. Area alerts: known contacts (past recipients) near THIS lead.
  // Pre-qualified — their email/coords/commercial snapshot came from the
  // original campaign, so no Apollo, geocode, or scrape spend. The selector
  // enforces the cadence guardrails; accounts + suppression checked here.
  if (!opts?.candidates) {
    const history = await db
      .select({
        company_key: schema.buyerOutreach.company_key,
        company_name: schema.buyerOutreach.company_name,
        property_id: schema.buyerOutreach.property_id,
        website: schema.buyerOutreach.website,
        email: schema.buyerOutreach.email,
        phone: schema.buyerOutreach.phone,
        contact_form_url: schema.buyerOutreach.contact_form_url,
        office_city: schema.buyerOutreach.office_city,
        office_lat: schema.buyerOutreach.office_lat,
        office_lng: schema.buyerOutreach.office_lng,
        commercial_signal: schema.buyerOutreach.commercial_signal,
        status: schema.buyerOutreach.status,
        sent_at: schema.buyerOutreach.sent_at,
        resend_message_id: schema.buyerOutreach.resend_message_id,
        opened_at: schema.buyerOutreach.opened_at,
        clicked_at: schema.buyerOutreach.clicked_at,
        claim_url: schema.buyerOutreach.claim_url,
      })
      .from(schema.buyerOutreach)
      .orderBy(desc(schema.buyerOutreach.created_at))
      .limit(5000);
    const known = selectKnownContacts(history, lead, new Date(), trade).filter(
      (k) => !accountKeys.has(k.key) && !blockedKeys.has(k.key) && !suppressed.has(k.email.toLowerCase())
    );
    for (const k of known.slice(0, want)) {
      qualified.push({
        c: { name: k.name, website: k.website, city: k.city, state: "TX" },
        key: k.key,
        coords: k.coords,
        distance: k.distance,
        commercial: k.commercial,
        email: k.email,
        phone: k.phone,
        form: k.form,
      });
      offeredThis.add(k.key);
      offeredEmails.add(k.email.toLowerCase());
      log.push(
        `  ↺ ${k.name} (${k.distance.toFixed(0)} mi) — known contact, new lead in their area`
      );
    }
    if (known.length) log.push(`${qualified.length} known contact(s) re-offered this new lead`);
  }

  // ---- 4. Candidate companies (Apollo near the lead's city, or injected).
  // Small-town leads (New Caney, Crosby...) often have zero companies AT the
  // city itself — the 40-mile office radius is measured from the lead's
  // coordinates, so widen to the metro before concluding there's nobody.
  const needDiscovery = qualified.filter((q) => q.email).length < want;
  let candidates: BuyerCandidate[] = [];
  if (opts?.candidates) {
    candidates = opts.candidates;
  } else if (needDiscovery) {
    // The LEAD's metro, by its coordinates — a DFW lead pulls DFW companies
    // even though the deployment default is Houston. Discovery pages DEEP
    // (searchLandscapersDeep): page 1 of every worked metro is exhausted by
    // the 30-day cooldown, so we pull pages until enough not-yet-contacted
    // names surface.
    const mkt = marketForCoords(lead.lat, lead.lng);
    const freshName = (c: BuyerCandidate) => {
      const k = companyKey(c.name);
      return !accountKeys.has(k) && !cooled.has(k) && !offeredThis.has(k) && !blockedKeys.has(k);
    };
    candidates = await searchLandscapersDeep(
      lead.city ? `${lead.city}, ${mkt.metroSearch.split(", ")[1] ?? "Texas"}` : mkt.metroSearch,
      CANDIDATE_POOL,
      TRADES[trade].prospectKeywords,
      freshName,
      want * 3
    );
    // A small town yielding fewer FRESH companies than the target list can't
    // fill the blast — merge in the metro pool (deduped) when it runs short.
    if (candidates.filter(freshName).length < want && lead.city && lead.city.toLowerCase() !== mkt.metroCity) {
      log.push(`Only ${candidates.filter(freshName).length} fresh candidate(s) in ${lead.city} — widening to the ${mkt.label}.`);
      const seen = new Set(candidates.map((c) => companyKey(c.name)));
      const metro = await searchLandscapersDeep(
        mkt.metroSearch,
        CANDIDATE_POOL,
        TRADES[trade].prospectKeywords,
        freshName,
        want * 3
      );
      candidates = [...candidates, ...metro.filter((c) => !seen.has(companyKey(c.name)))];
    }
  } else {
    log.push("Known contacts fill the list — skipping discovery this run.");
  }
  if (!candidates.length && !qualified.length) {
    log.push("No candidates even metro-wide — check APOLLO_API_KEY.");
    return { lead: lead.id, candidates: 0, qualified: 0, queued: 0, sent: 0, skippedNoEmail: 0, log };
  }
  if (candidates.length) log.push(`${candidates.length} candidate companies`);

  // ---- 5. Qualify one by one until the list is full (bounded attempts).
  // Fall back to the LEAD's metro state (not always Texas) when a candidate's
  // own state is blank, so a stateless "Winter Park" geocodes in Florida.
  const leadState = marketForCoords(lead.lat, lead.lng).state ?? "TX";
  let attempts = Math.min(candidates.length, want * 3);
  for (const c of candidates) {
    if (qualified.filter((q) => q.email).length >= want || attempts <= 0) break;
    const key = companyKey(c.name);
    if (accountKeys.has(key) || cooled.has(key) || offeredThis.has(key)) continue;
    if (blockedKeys.has(key)) {
      log.push(`  \u00d7 ${c.name} \u2014 blocked (operator verdict on /companies)`);
      continue;
    }
    if (opts?.excludeKeys?.some((x) => x && key.includes(x))) {
      log.push(`  \u00d7 ${c.name} \u2014 excluded by operator`);
      // LEARNED blocklist: a live-send exclude is an operator verdict, not a
      // one-off \u2014 persist it as blocked so no future run (especially the
      // autonomous daily engine) ever re-surfaces this company.
      if (doSend && !opts?.dryRun) {
        try {
          await upsertProspectCompany({ name: c.name, trade });
          await db
            .update(schema.prospectCompany)
            .set({
              blocked_at: new Date(),
              blocked_reason: "operator exclude= on a live send",
              updated_at: new Date(),
            })
            .where(eq(schema.prospectCompany.key, key));
        } catch {
          // best-effort: the exclusion itself already applied this run
        }
      }
      continue;
    }
    attempts--;

    // Vertical gate: Apollo keyword search pulls in adjacent verticals
    // (software vendors, suppliers, the odd vet clinic) — a wrong-trade
    // pitch is spam. Name check is free; the homepage settles the rest.
    const vendorRe = TRADES[trade].vendorSignal;
    let vendor = vendorRe.test(c.name);
    if (!vendor && c.website) vendor = await siteMatchesVendor(c.website, vendorRe);
    if (!vendor) {
      log.push(`  \u00d7 ${c.name} \u2014 skipped, no ${trade} signal (wrong vertical)`);
      continue;
    }

    // Geographic coverage: office (often city-level) within range of the lead.
    const officeArea = c.city ? `${c.city}, ${c.state ?? leadState}` : null;
    const coords = officeArea ? await geocodeAddress(officeArea, "place,address,poi") : null;
    const distance = coords ? haversineMiles([coords[0], coords[1]], [lead.lng, lead.lat]) : null;
    if (distance != null && distance > MAX_DISTANCE_MI) continue;

    // Deliverable channel + commercial signal (both from their own website).
    // A site that hides its address falls back to the company graph — the
    // weekly Apollo enrichment writes emails there for exactly this pool, and
    // without this fallback those credits bought addresses nothing ever read.
    const contact = c.website
      ? await scrapeBusinessContact(c.website)
      : { email: null, phone: null, contact_form_url: null };
    const enriched = !contact.email ? graphEmail.get(key) ?? null : null;
    const email = contact.email ?? enriched;
    if (email && suppressed.has(email.toLowerCase())) continue;
    // Same-inbox guard: a different name spelling resolving to an email we've
    // already touched (30-day cooldown, either engine) or already queued this
    // run/lead is the same company — skip, don't double-mail.
    if (email && (cooledEmails.has(email.toLowerCase()) || offeredEmails.has(email.toLowerCase()))) {
      log.push(`  × ${c.name} — same inbox already contacted (email-level dedupe)`);
      continue;
    }
    const commercial = await looksCommercial(c.website);
    if (!email) skippedNoEmail++;

    qualified.push({
      c,
      key,
      coords,
      distance,
      commercial,
      email,
      phone: contact.phone,
      form: contact.contact_form_url,
    });
    offeredThis.add(key); // guard against duplicate names inside one pool
    if (email) offeredEmails.add(email.toLowerCase());
    log.push(
      `  ${email ? "✓" : "·"} ${c.name}${distance != null ? ` (${distance.toFixed(0)} mi)` : ""}` +
        `${commercial ? " [commercial]" : commercial === false ? " [resi?]" : ""}` +
        `${enriched ? " [email via enrichment]" : ""}${email ? "" : " — no email, queued as skipped"}`
    );
  }

  // Commercial-signal shops first, then closest. Emailables fill the list;
  // no-email companies are recorded as `skipped` for manual paste outreach.
  qualified.sort((a, b) => {
    const cs = Number(b.commercial === true) - Number(a.commercial === true);
    return cs !== 0 ? cs : (a.distance ?? 999) - (b.distance ?? 999);
  });
  const emailable = qualified.filter((q) => q.email).slice(0, want);
  const manual = qualified.filter((q) => !q.email);

  // ---- 6. Queue (and optionally send) each offer.
  const base = siteBase();
  const cap = leadMaxBuyers();
  let queued = 0;
  let sent = 0;
  let variantIdx = 0; // alternate A/B across the emailable list
  for (const q of [...emailable, ...manual]) {
    if (opts?.dryRun) {
      if (q.email) queued++;
      log.push(`  DRY ${q.c.name} -> ${q.email ?? "(no email — would record for manual paste)"}`);
      continue;
    }
    const claimUrl = `${base}/buyers/claim/${signBuyerClaim(lead.id, q.c.name)}?trade=${trade}`;
    const subjectVariant: "A" | "B" = q.email ? (variantIdx++ % 2 === 0 ? "A" : "B") : "A";
    const msg = buildProspectMessage({
      subjectVariant,
      company: q.c.name,
      lead,
      distanceMi: q.distance,
      brand: co.name,
      replyEmail,
      // Tiered off THIS trade's value estimate: the pitch quotes the same
      // price checkout will charge a buyer of this trade.
      price: Math.round(
        leadTierFor(lead.value?.annualHi ?? null, lead.kind).price_cents / 100
      ),
      cap,
      claimUrl,
      trade,
    });
    // The partial unique index (property_id, company_key) makes this the
    // cross-process dedupe point: a concurrent run's insert conflicts and we
    // fall back to the existing row — reusing it only while still 'queued'
    // (which also makes preview-queued rows from the CLI actually sendable).
    let [row] = await db
      .insert(schema.buyerOutreach)
      .values({
        property_id: lead.id,
        company_key: q.key,
        company_name: q.c.name,
        website: q.c.website,
        email: q.email,
        phone: q.phone,
        contact_form_url: q.form,
        office_city: q.c.city,
        office_lat: q.coords?.[1] ?? null,
        office_lng: q.coords?.[0] ?? null,
        distance_mi: q.distance,
        commercial_signal: q.commercial,
        claim_url: claimUrl,
        message: `SUBJECT[${subjectVariant}]: ${msg.subject}\n\n${msg.body}`,
        status: q.email ? "queued" : "skipped",
      })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      const [existing] = await db
        .select()
        .from(schema.buyerOutreach)
        .where(
          and(
            eq(schema.buyerOutreach.property_id, lead.id),
            eq(schema.buyerOutreach.company_key, q.key)
          )
        )
        .limit(1);
      if (!existing || existing.status !== "queued") {
        log.push(`  ⊘ ${q.c.name} — already handled by another run`);
        continue;
      }
      row = existing;
    }
    // Refresh the company's profile (identity + trade) — the company graph
    // every enrichment event (claim views, signup linkage) lands on.
    await upsertProspectCompany({
      name: q.c.name,
      trade,
      website: q.c.website,
      email: q.email,
      phone: q.phone,
      contact_form_url: q.form,
      office_city: q.c.city,
      office_lat: q.coords?.[1] ?? null,
      office_lng: q.coords?.[0] ?? null,
      commercial_signal: q.commercial,
    });
    if (!q.email) continue;
    queued++;

    if (doSend && row) {
      // ATOMIC CLAIM before the send: only one run can flip queued→sent, so
      // overlapping runs can never email the same company twice.
      const claimed = await db
        .update(schema.buyerOutreach)
        .set({ status: "sent", sent_at: new Date(), updated_at: new Date() })
        .where(
          and(eq(schema.buyerOutreach.id, row.id), eq(schema.buyerOutreach.status, "queued"))
        )
        .returning({ id: schema.buyerOutreach.id });
      if (claimed.length === 0) {
        log.push(`  ⊘ ${q.c.name} — sent by another run`);
        continue;
      }
      const unsubUrl = `${base}/api/unsubscribe?token=${encodeURIComponent(signBuyerUnsub(q.email))}`;
      const res = await sendEmail({
        to: q.email,
        subject: msg.subject,
        html: toHtml(msg.body, unsubUrl, co.physical_mailing_address ?? null),
        // Replies are the conversion event — route them to the watched inbox.
        replyTo: replyEmail || undefined,
        stream: "campaign", // cold outreach — isolate from transactional domain reputation
        tags: { kind: "buyer_prospecting", variant: subjectVariant },
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      if (res.ok) {
        sent++;
        await db
          .update(schema.buyerOutreach)
          .set({
            // The Resend message id keys webhook events (delivered/opened/
            // clicked/bounced) back to this row for the campaign funnel.
            resend_message_id: res.id,
            updated_at: new Date(),
          })
          .where(eq(schema.buyerOutreach.id, row.id));
      } else {
        // Send failed after the claim — release the row so a retry can send.
        await db
          .update(schema.buyerOutreach)
          .set({ status: "queued", sent_at: null, updated_at: new Date() })
          .where(eq(schema.buyerOutreach.id, row.id));
        log.push(`  ✗ send failed: ${q.c.name} (${res.error})`);
      }
    }
  }
  if (opts?.dryRun && queued) {
    log.push(`DRY RUN — ${queued} offer(s) would send; nothing was written or sent.`);
  } else if (!doSend && queued) {
    log.push(
      `${queued} offer(s) QUEUED, not sent — set PROSPECTING_AUTOSEND=1 (standing approval) or run the CLI with --send.`
    );
  }

  return {
    lead: lead.id,
    candidates: candidates.length,
    qualified: qualified.length,
    queued,
    sent,
    skippedNoEmail,
    log,
  };
}
