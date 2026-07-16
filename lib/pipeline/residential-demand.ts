// Residential demand-gen: pitch a PUBLISHED residential package to home-
// service companies near its geography — including the residential-only
// companies the commercial engine deliberately deprioritizes. Same posture as
// buyer prospecting (lib/pipeline/buyer-prospecting): dry-run by default,
// operator prune via excludeKeys, one-click unsubscribe on every send,
// suppression + blocklist + 30-day politeness cooldown shared with the
// commercial campaigns (a company pitched a job sheet last week doesn't get
// a package pitch this week). Apollo data is for our own targeting only.
//
// Differences from the commercial engine, on purpose:
//  - No claim token: the CTA is the buyer signup/marketplace link. The
//    package page is the pitch; the report is the product.
//  - No commercial-signal preference — residential-leaning shops are the
//    TARGET here, not the fallback. Sort is distance-only.
//  - Send authority is per-run only (?send=1). No autosend env var, no cron
//    schedule — every wave is an operator decision.

import { and, eq, gte, like } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { marketForCoords } from "../markets";
import { searchLandscapers, type BuyerCandidate } from "../integrations/apollo";
import { asTrade, TRADES, type Trade } from "../leads/trades";
import { scrapeBusinessContact } from "../integrations/contact";
import { geocodeAddress } from "../integrations/geocoding";
import { sendEmail } from "../integrations/resend";
import { signBuyerUnsub } from "../buyer-auth";
import { haversineMiles } from "../sourcing/criteria";
import { companyKey, upsertProspectCompany } from "../leads/companies";
import {
  toHtml,
  siteBase,
  siteMatchesVendor,
  COOLDOWN_DAYS,
  MAX_DISTANCE_MI,
} from "./buyer-prospecting";
import type { PackageTeaser } from "../residential/teaser";

const WANT_COMPANIES = 30;
const CANDIDATE_POOL = 100;

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;

/** The pitch email. Honest by construction: counts/price from the package
 *  row, geography from the leads, and the signal is described as county deed
 *  records over the recent months — never "this week". */
export function buildPackagePitch(o: {
  subjectVariant: "A" | "B";
  company: string;
  pkg: { name: string; lead_count: number; price_cents: number };
  geography: string;
  trade: Trade;
  brand: string;
  replyEmail: string | null;
  ctaUrl: string;
}): { subject: string; body: string } {
  const t = TRADES[o.trade];
  const price = usd(o.pkg.price_cents);
  const subject =
    o.subjectVariant === "B"
      ? `Who just bought a home in ${o.geography} — ${o.pkg.lead_count} verified addresses`
      : `${o.pkg.lead_count} new homeowners in ${o.geography} for ${price}`;
  const body =
    `Hi ${o.company},\n\n` +
    `New homeowners hire ${t.service} providers in their first months — before they have anyone. ` +
    `We pulled every recent single-family sale in ${o.geography} from county deed records and packaged the addresses:\n\n` +
    `${o.pkg.name}\n` +
    `- ${o.pkg.lead_count} addresses, each with the recorded sale date, estimated home value, and lot size\n` +
    `- Sourced from official county records over the past months (every date shown, nothing hidden)\n` +
    `- ${price} one-time for the full list + CSV download for your route planner\n\n` +
    `See it here: ${o.ctaUrl}\n\n` +
    `We're ${o.brand} — we also run capped commercial job leads for ${t.noun} in Texas, if that's more your book.\n\n` +
    `Reply to this email with any questions${o.replyEmail ? ` (${o.replyEmail})` : ""}.`;
  return { subject, body };
}

export type ResidentialDemandSummary = {
  package: string | null;
  candidates: number;
  qualified: number;
  queued: number;
  sent: number;
  skippedNoEmail: number;
  log: string[];
};

export async function runResidentialDemandGen(opts: {
  packageId: string;
  trade: Trade;
  want?: number;
  send?: boolean;
  dryRun?: boolean;
  excludeKeys?: string[];
}): Promise<ResidentialDemandSummary> {
  const want = opts.want ?? WANT_COMPANIES;
  const trade = asTrade(opts.trade);
  const doSend = opts.send === true && !opts.dryRun;
  const log: string[] = [];
  const empty = { candidates: 0, qualified: 0, queued: 0, sent: 0, skippedNoEmail: 0, log };

  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found.");
  const replyEmail = process.env.RESEND_FROM?.match(/<([^>]+)>/)?.[1] ?? process.env.RESEND_FROM ?? null;

  // ---- 1. The package. SENDS require published — the CTA must be buyable.
  const [pkg] = await db
    .select()
    .from(schema.residentialPackage)
    .where(eq(schema.residentialPackage.id, opts.packageId))
    .limit(1);
  if (!pkg) {
    log.push("Package not found.");
    return { package: null, ...empty };
  }
  if (doSend && pkg.status !== "published") {
    log.push(`Package is '${pkg.status}' — publish it before pitching (the CTA must be buyable).`);
    return { package: pkg.id, ...empty };
  }
  const teaser = pkg.signal_summary as PackageTeaser | null;
  const geography = pkg.geography_label ?? pkg.zip ?? teaser?.cities?.[0] ?? "your area";

  // Warm the ATTOM cache BEFORE the first pitch goes out (once-ever per
  // lead): a buyer who purchases minutes after the email must get owner
  // names without the Stripe webhook doing 20+ metered fetches.
  if (doSend) {
    const { enrichPackageLeads } = await import("../residential/dossier");
    await enrichPackageLeads(pkg.id).catch(() => 0);
  }

  // Centroid of the member addresses — the anchor for radius + metro.
  const members = await db
    .select({ lat: schema.residentialLead.lat, lng: schema.residentialLead.lng })
    .from(schema.residentialPackageMembership)
    .innerJoin(
      schema.residentialLead,
      eq(schema.residentialPackageMembership.residential_lead_id, schema.residentialLead.id)
    )
    .where(eq(schema.residentialPackageMembership.package_id, pkg.id));
  const placed = members.filter((m) => m.lat != null && m.lng != null);
  if (!placed.length) {
    log.push("Package has no geocoded addresses — can't anchor a radius.");
    return { package: pkg.id, ...empty };
  }
  const centroid: [number, number] = [
    placed.reduce((a, m) => a + m.lng!, 0) / placed.length,
    placed.reduce((a, m) => a + m.lat!, 0) / placed.length,
  ];
  log.push(`Package: ${pkg.name} — ${pkg.lead_count} addresses, ${usd(pkg.price_cents)} (${pkg.status})`);

  // ---- 2. Exclusions: accounts, blocklist, suppression, politeness, dedupe.
  const existingBuyers = await db.select({ name: schema.buyer.company_name }).from(schema.buyer);
  const accountKeys = new Set(existingBuyers.map((b) => companyKey(b.name)));
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
  // Politeness cooldown spans ALL outreach (commercial campaigns included).
  const since = new Date(Date.now() - COOLDOWN_DAYS * 86400_000);
  const recent = await db
    .select({ key: schema.buyerOutreach.company_key })
    .from(schema.buyerOutreach)
    .where(and(gte(schema.buyerOutreach.created_at, since), eq(schema.buyerOutreach.status, "sent")));
  const cooled = new Set(recent.map((r) => r.key));
  // One pitch per company per package, ever (no partial-unique-index cover
  // here — residential rows carry property_id NULL — so dedupe by query).
  const pitchedThis = new Set(
    (
      await db
        .select({ key: schema.buyerOutreach.company_key })
        .from(schema.buyerOutreach)
        .where(like(schema.buyerOutreach.claim_url, `%respkg=${pkg.id}%`))
    ).map((r) => r.key)
  );
  const suppressed = new Set(
    (await db.select({ email: schema.suppression.email }).from(schema.suppression)).map((r) =>
      r.email.toLowerCase()
    )
  );

  // ---- 3. Candidates: Apollo near the package's metro.
  const mkt = marketForCoords(centroid[1], centroid[0]);
  const anchorCity = teaser?.cities?.[0];
  let candidates: BuyerCandidate[] = await searchLandscapers(
    anchorCity ? `${anchorCity}, ${mkt.metroSearch.split(", ")[1] ?? "Texas"}` : mkt.metroSearch,
    CANDIDATE_POOL,
    TRADES[trade].prospectKeywords
  );
  if (candidates.length < want && anchorCity && anchorCity.toLowerCase() !== mkt.metroCity) {
    log.push(`Only ${candidates.length} candidate(s) in ${anchorCity} — widening to the ${mkt.label}.`);
    const seen = new Set(candidates.map((c) => companyKey(c.name)));
    const metro = await searchLandscapers(mkt.metroSearch, CANDIDATE_POOL, TRADES[trade].prospectKeywords);
    candidates = [...candidates, ...metro.filter((c) => !seen.has(companyKey(c.name)))];
  }
  if (!candidates.length) {
    log.push("No candidates metro-wide — check APOLLO_API_KEY.");
    return { package: pkg.id, ...empty };
  }
  log.push(`${candidates.length} candidate companies`);

  // ---- 4. Qualify until full. Residential-friendly: no commercial-signal
  // gate — the vertical check and geography are the only filters.
  type Qualified = {
    c: BuyerCandidate;
    key: string;
    coords: [number, number] | null;
    distance: number | null;
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
    if (accountKeys.has(key) || cooled.has(key) || pitchedThis.has(key)) continue;
    if (blockedKeys.has(key)) {
      log.push(`  × ${c.name} — blocked (operator verdict on /companies)`);
      continue;
    }
    if (opts.excludeKeys?.some((x) => x && key.includes(x))) {
      log.push(`  × ${c.name} — excluded by operator`);
      continue;
    }
    attempts--;

    const vendorRe = TRADES[trade].vendorSignal;
    let vendor = vendorRe.test(c.name);
    if (!vendor && c.website) vendor = await siteMatchesVendor(c.website, vendorRe);
    if (!vendor) {
      log.push(`  × ${c.name} — skipped, no ${trade} signal (wrong vertical)`);
      continue;
    }

    const officeArea = c.city ? `${c.city}, ${c.state ?? mkt.state ?? "TX"}` : null;
    const coords = officeArea ? await geocodeAddress(officeArea, "place,address,poi") : null;
    const distance = coords ? haversineMiles([coords[0], coords[1]], centroid) : null;
    if (distance != null && distance > MAX_DISTANCE_MI) continue;

    const contact = c.website
      ? await scrapeBusinessContact(c.website)
      : { email: null, phone: null, contact_form_url: null };
    const email = contact.email ?? graphEmail.get(key) ?? null;
    if (email && suppressed.has(email.toLowerCase())) continue;
    if (!email) skippedNoEmail++;

    qualified.push({ c, key, coords, distance, email, phone: contact.phone, form: contact.contact_form_url });
    pitchedThis.add(key);
    log.push(
      `  ${email ? "✓" : "·"} ${c.name}${distance != null ? ` (${distance.toFixed(0)} mi)` : ""}` +
        `${email ? "" : " — no email, recorded as skipped"}`
    );
  }
  qualified.sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999));
  const emailable = qualified.filter((q) => q.email).slice(0, want);
  const manual = qualified.filter((q) => !q.email);

  // ---- 5. Queue + send.
  const base = siteBase();
  const ctaUrl = `${base}/buyers/signup?respkg=${pkg.id}&trade=${trade}`;
  let queued = 0;
  let sent = 0;
  let variantIdx = 0;
  for (const q of [...emailable, ...manual]) {
    if (!doSend) {
      if (q.email) queued++;
      log.push(`  DRY ${q.c.name} -> ${q.email ?? "(no email — would record for manual paste)"}`);
      continue;
    }
    const subjectVariant: "A" | "B" = q.email ? (variantIdx++ % 2 === 0 ? "A" : "B") : "A";
    const msg = buildPackagePitch({
      subjectVariant,
      company: q.c.name,
      pkg,
      geography,
      trade,
      brand: co.name,
      replyEmail,
      ctaUrl,
    });
    const [row] = await db
      .insert(schema.buyerOutreach)
      .values({
        property_id: null, // residential pitch — not a commercial lead offer
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
        commercial_signal: null,
        claim_url: ctaUrl,
        message: `SUBJECT[${subjectVariant}]: ${msg.subject}\n\n${msg.body}`,
        status: q.email ? "queued" : "skipped",
      })
      .returning();
    if (!row) continue;
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
    }).catch(() => null);
    if (!q.email) continue;
    queued++;

    // Atomic queued->sent claim (same shape as the commercial engine): only
    // one run can flip the row, so overlapping runs never double-email.
    const claimed = await db
      .update(schema.buyerOutreach)
      .set({ status: "sent", sent_at: new Date(), updated_at: new Date() })
      .where(and(eq(schema.buyerOutreach.id, row.id), eq(schema.buyerOutreach.status, "queued")))
      .returning({ id: schema.buyerOutreach.id });
    if (claimed.length === 0) continue;
    const unsubUrl = `${base}/api/unsubscribe?token=${encodeURIComponent(signBuyerUnsub(q.email))}`;
    const res = await sendEmail({
      to: q.email,
      subject: msg.subject,
      html: toHtml(msg.body, unsubUrl, null),
      stream: "campaign", // cold outreach — isolate from transactional domain reputation
      tags: { kind: "residential_demand", variant: subjectVariant },
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (res.ok) {
      sent++;
      if (res.id) {
        await db
          .update(schema.buyerOutreach)
          .set({ resend_message_id: res.id })
          .where(eq(schema.buyerOutreach.id, row.id));
      }
    } else {
      // Release the claim so a retry run can send it.
      await db
        .update(schema.buyerOutreach)
        .set({ status: "queued", sent_at: null })
        .where(eq(schema.buyerOutreach.id, row.id));
      log.push(`  ! send failed to ${q.c.name}: ${res.error ?? "unknown"}`);
    }
  }
  log.push(
    doSend
      ? `${sent} pitch(es) sent, ${manual.length} recorded for manual outreach`
      : `${queued} emailable (DRY RUN — nothing written or sent)`
  );
  return { package: pkg.id, candidates: candidates.length, qualified: qualified.length, queued, sent, skippedNoEmail, log };
}
