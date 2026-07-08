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

import { and, eq, gte } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { searchLandscapers, type BuyerCandidate } from "../integrations/apollo";
import { scrapeBusinessContact } from "../integrations/contact";
import { geocodeAddress } from "../integrations/geocoding";
import { sendEmail } from "../integrations/resend";
import { signBuyerClaim, signBuyerUnsub } from "../buyer-auth";
import { leadMaxBuyers } from "../leads/availability";
import { haversineMiles } from "../sourcing/criteria";
import { loadMarketLeads, type LeadKind, type MarketLead } from "../leads/market";
import { leadTierFor } from "../leads/pricing-tiers";

/** Don't email the same company again within this window. */
export const COOLDOWN_DAYS = 30;
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
};

export function toPitch(l: MarketLead): LeadPitch | null {
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
  };
}

/** The outreach email, personalized to the company and framed by lead kind.
 *  Honest: says exactly what we are; never impersonates a customer. */
export function buildProspectMessage(o: {
  company: string;
  lead: LeadPitch;
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
  const hook =
    lead.kind === "transfer"
      ? `A commercial property${distClause}${lead.city ? ` (${lead.city} area)` : ""} just changed owners — and new owners re-bid their grounds vendors in the first year.`
      : lead.kind === "opening"
        ? `A new business is opening at a commercial property${distClause}${lead.city ? ` (${lead.city} area)` : ""} — the property's vendor decisions are being made right now.`
        : `A commercial development breaks ground${distClause}${lead.city ? ` (${lead.city} area)` : ""}. When it opens, somebody wins the grounds contract.`;
  const subject = `${usd(lead.annualHi)}/yr grounds contract${distShort}`;
  const body = `${o.company} team —

${hook}

We measured the site from the air${lead.turf ? `: ~${Math.round(lead.turf).toLocaleString()} sq ft of maintainable turf` : ""}. At market rates that's ${usd(lead.annualLo)}–${usd(lead.annualHi)} a year — every year.

Everything a bidder needs is on one page: exact location, the owner to contact, our measurement, crew sizing, and the window to bid. Every job is capped at ${o.cap} companies — ever — and you can lock one down as an exclusive so nobody else gets it.

Your first sheet is FREE — claim it here (takes 30 seconds, no card):
${o.claimUrl}

The full sheet unlocks the moment you create your profile. After that they're $${o.price} each. Or just reply "SEND IT" and we'll set it up for you.

— ${o.brand}
${o.replyEmail}

P.S. If this one's too far or the wrong size, reply with your service area and we'll send the next match instead.`;
  return { subject, body };
}

/** Message text -> simple branded HTML with the compliance footer. */
function toHtml(body: string, unsubUrl: string, physicalAddress: string | null): string {
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

function siteBase(): string {
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
  want?: number;
  /** Force-send this run regardless of PROSPECTING_AUTOSEND (CLI --send). */
  send?: boolean;
  /** Report what WOULD happen — no rows written, nothing sent (the cron's
   *  mode while automation is off, so unattended runs have zero side effects). */
  dryRun?: boolean;
  /** Candidate source override (tests / campaign CSV); default Apollo. */
  candidates?: BuyerCandidate[];
}): Promise<ProspectingRunSummary> {
  const want = opts?.want ?? WANT_COMPANIES;
  const doSend = opts?.send ?? autosendEnabled();
  const log: string[] = [];
  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found. Run `npm run db:seed` first.");
  const replyEmail = co.email?.trim() || "";
  

  // ---- 1. The lead: requested, or best fresh uncampaigned one on the shelf.
  const market = await loadMarketLeads();
  let lead: LeadPitch | null = null;
  if (opts?.propertyId) {
    const l = market.find((m) => m.p.id === opts.propertyId);
    lead = l ? toPitch(l) : null;
    if (!lead) {
      log.push("Requested property is not an open, teaser-priced lead — nothing to offer.");
      return { lead: null, candidates: 0, qualified: 0, queued: 0, sent: 0, skippedNoEmail: 0, log };
    }
  } else {
    const campaigned = new Set(
      (
        await db
          .select({ pid: schema.buyerOutreach.property_id })
          .from(schema.buyerOutreach)
      )
        .map((r) => r.pid)
        .filter(Boolean) as string[]
    );
    const fresh = market
      .filter((l) => !campaigned.has(l.p.id) && l.ageDays <= 14)
      .map((l) => ({ l, pitch: toPitch(l) }))
      .filter((x) => x.pitch)
      .sort((a, b) => b.pitch!.annualHi - a.pitch!.annualHi);
    lead = fresh[0]?.pitch ?? null;
    if (!lead) {
      log.push("No fresh uncampaigned leads on the shelf — nothing to do.");
      return { lead: null, candidates: 0, qualified: 0, queued: 0, sent: 0, skippedNoEmail: 0, log };
    }
  }
  log.push(
    `Lead: ${lead.city ?? "?"} ${lead.kind}, ${usd(lead.annualLo)}–${usd(lead.annualHi)}/yr (${lead.id.slice(0, 8)})`
  );

  // ---- 2. Candidate companies (Apollo near the lead's city, or injected).
  const candidates =
    opts?.candidates ??
    (await searchLandscapers(`${lead.city ?? "Houston"}, Texas`, CANDIDATE_POOL));
  if (!candidates.length) {
    log.push("No candidates (APOLLO_API_KEY unset or search empty).");
    return { lead: lead.id, candidates: 0, qualified: 0, queued: 0, sent: 0, skippedNoEmail: 0, log };
  }
  log.push(`${candidates.length} candidate companies`);

  // ---- 3. Exclusions: existing accounts + cooldown + already-offered-this-lead.
  const existingBuyers = await db.select({ name: schema.buyer.company_name }).from(schema.buyer);
  const accountKeys = new Set(existingBuyers.map((b) => companyKey(b.name)));
  // Cooldown counts only ACTUAL contact (sent) — queued/skipped rows are
  // records, not touches, and must not block a company for 30 days.
  const since = new Date(Date.now() - COOLDOWN_DAYS * 86400_000);
  const recent = await db
    .select({ key: schema.buyerOutreach.company_key })
    .from(schema.buyerOutreach)
    .where(and(gte(schema.buyerOutreach.created_at, since), eq(schema.buyerOutreach.status, "sent")));
  const cooled = new Set(recent.map((r) => r.key));
  const offeredThis = new Set(
    (
      await db
        .select({ key: schema.buyerOutreach.company_key })
        .from(schema.buyerOutreach)
        .where(eq(schema.buyerOutreach.property_id, lead.id))
    ).map((r) => r.key)
  );

  const suppressed = new Set(
    (await db.select({ email: schema.suppression.email }).from(schema.suppression)).map((r) => r.email)
  );

  // ---- 4. Qualify one by one until the list is full (bounded attempts).
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
  let attempts = Math.min(candidates.length, want * 3);
  for (const c of candidates) {
    if (qualified.filter((q) => q.email).length >= want || attempts <= 0) break;
    const key = companyKey(c.name);
    if (accountKeys.has(key) || cooled.has(key) || offeredThis.has(key)) continue;
    attempts--;

    // Geographic coverage: office (often city-level) within range of the lead.
    const officeArea = c.city ? `${c.city}${c.state ? `, ${c.state}` : ", TX"}` : null;
    const coords = officeArea ? await geocodeAddress(officeArea, "place,address,poi") : null;
    const distance = coords ? haversineMiles([coords[0], coords[1]], [lead.lng, lead.lat]) : null;
    if (distance != null && distance > MAX_DISTANCE_MI) continue;

    // Deliverable channel + commercial signal (both from their own website).
    const contact = c.website
      ? await scrapeBusinessContact(c.website)
      : { email: null, phone: null, contact_form_url: null };
    if (contact.email && suppressed.has(contact.email.toLowerCase())) continue;
    const commercial = await looksCommercial(c.website);
    if (!contact.email) skippedNoEmail++;

    qualified.push({
      c,
      key,
      coords,
      distance,
      commercial,
      email: contact.email,
      phone: contact.phone,
      form: contact.contact_form_url,
    });
    offeredThis.add(key); // guard against duplicate names inside one pool
    log.push(
      `  ${contact.email ? "✓" : "·"} ${c.name}${distance != null ? ` (${distance.toFixed(0)} mi)` : ""}` +
        `${commercial ? " [commercial]" : commercial === false ? " [resi?]" : ""}${contact.email ? "" : " — no email, queued as skipped"}`
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

  // ---- 5. Queue (and optionally send) each offer.
  const base = siteBase();
  const cap = leadMaxBuyers();
  let queued = 0;
  let sent = 0;
  for (const q of [...emailable, ...manual]) {
    if (opts?.dryRun) {
      if (q.email) queued++;
      log.push(`  DRY ${q.c.name} -> ${q.email ?? "(no email — would record for manual paste)"}`);
      continue;
    }
    const claimUrl = `${base}/buyers/claim/${signBuyerClaim(lead.id, q.c.name)}`;
    const msg = buildProspectMessage({
      company: q.c.name,
      lead,
      distanceMi: q.distance,
      brand: co.name,
      replyEmail,
      // Tiered: the pitch quotes the same price checkout will charge.
      price: Math.round(leadTierFor(lead.annualHi).price_cents / 100),
      cap,
      claimUrl,
    });
    const [row] = await db
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
        message: `SUBJECT: ${msg.subject}\n\n${msg.body}`,
        status: q.email ? "queued" : "skipped",
      })
      .returning();
    if (!q.email) continue;
    queued++;

    if (doSend && row) {
      const unsubUrl = `${base}/api/unsubscribe?token=${encodeURIComponent(signBuyerUnsub(q.email))}`;
      const res = await sendEmail({
        to: q.email,
        subject: msg.subject,
        html: toHtml(msg.body, unsubUrl, co.physical_mailing_address ?? null),
        tags: { kind: "buyer_prospecting" },
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      if (res.ok) {
        sent++;
        await db
          .update(schema.buyerOutreach)
          .set({ status: "sent", sent_at: new Date(), updated_at: new Date() })
          .where(eq(schema.buyerOutreach.id, row.id));
      } else {
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
