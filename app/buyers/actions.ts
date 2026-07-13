"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, gte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { alertOperatorOfSignup } from "@/lib/email/operator-alerts";
import { buyer, chatMessage, claimEvent, leadActivity, leadUnlock, property, suppression } from "@/lib/db/schema";
import {
  BUYER_COOKIE,
  BUYER_SESSION_MAX_AGE,
  phonePlaceholderEmail,
  signBuyerLogin,
  signBuyerSession,
  verifyBuyerClaim,
  verifyBuyerSession,
} from "@/lib/buyer-auth";
import { sendSms, toE164 } from "@/lib/integrations/twilio";
import { waitUntil } from "@vercel/functions";
import { alertLastSpot } from "@/lib/leads/scarcity";
import { buildDossier } from "@/lib/leads/dossier";
import { FREE_MAX_PER_LEAD } from "@/lib/leads/allocation";
import { displayName, freeVerdict, leadKind, loadMarketLeads, marketFreeContext } from "@/lib/leads/market";
import {
  closeLeadIfDone,
  confirmUnlockWithinCap,
  leadAvailability,
} from "@/lib/leads/availability";
import { createFirstLookCheckout, createLeadCheckout } from "@/lib/integrations/stripe";
import { firstLookPriceCents } from "@/lib/leads/subscription";
import { companyKey as companyKeyOf, linkCompanyToBuyer } from "@/lib/leads/companies";
import { liveHold, heldByOther, releaseHold } from "@/lib/leads/holds";
import { leadTierFor } from "@/lib/leads/pricing-tiers";
import { asTrade, TRADES, tradeValueInput } from "@/lib/leads/trades";
import { geocodeAddress, geocodeWithZip } from "@/lib/integrations/geocoding";
import { sendEmail } from "@/lib/integrations/resend";
import { magicLinkEmail } from "@/lib/email/transactional";
import { getDefaultCompany } from "@/lib/db/queries";
import { rateLimit, clientIp, LIMITS } from "@/lib/ratelimit";

function baseUrl(): string {
  const envBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (envBase && !/localhost|127\.0\.0\.1/.test(envBase)) return envBase;
  const host = headers().get("host");
  return host ? `https://${host}` : "https://greenkeep.us";
}

export async function currentBuyerId(): Promise<string | null> {
  const id = verifyBuyerSession(cookies().get(BUYER_COOKIE)?.value);
  if (!id) return null;
  // Session revocation: a stateless HMAC session can't be invalidated by
  // rotating the secret without logging everyone out, so a banned buyer is
  // checked here — the one choke point every authenticated buyer action calls.
  // Banned = treated as logged out (portal, unlocks, prospecting all gated).
  const [row] = await db
    .select({ banned_at: buyer.banned_at })
    .from(buyer)
    .where(eq(buyer.id, id))
    .limit(1);
  if (!row || row.banned_at) return null;
  return id;
}

/**
 * Claim flow: a campaign token identifies the free lead. Creating the profile
 * is the notification opt-in; the free lead unlocks immediately (with a dossier
 * snapshot) if a shared spot is still open AND this buyer hasn't already used
 * their free claim — the profile gets created and the session starts either
 * way, so the buyer always lands on the dashboard.
 */
export async function createBuyerProfile(token: string, formData: FormData): Promise<void> {
  const claim = verifyBuyerClaim(token);
  if (!claim) redirect("/buyers/login?expired=1");

  const emailRaw = ((formData.get("email") as string) || "").trim().toLowerCase();
  const phone = toE164((formData.get("phone") as string) || "");
  const company = ((formData.get("company") as string) || "").trim();
  const city = ((formData.get("city") as string) || "").trim();
  const trade = asTrade(formData.get("trade"));
  // Email OR mobile — the SMS channel deliberately targets companies with no
  // email address, so the claim form can't demand one. Phone-only profiles
  // store a deterministic internal placeholder (same phone → same row on
  // re-claim) and sign in via SMS magic link.
  if (!company || (!emailRaw.includes("@") && !phone)) redirect(`/buyers/claim/${token}?error=1`);
  const email = emailRaw.includes("@") ? emailRaw : phonePlaceholderEmail(phone!);

  // Abuse cap on account creation.
  const rl = await rateLimit(`buyerclaim:ip:${clientIp()}`, 10, 3600);
  if (!rl.ok) redirect(`/buyers/claim/${token}?error=1`);

  const co = await getDefaultCompany();
  const coords = city ? await geocodeAddress(`${city}, TX`, "place,address,poi") : null;

  const [existing] = await db.select().from(buyer).where(eq(buyer.email, email)).limit(1);
  const row =
    existing ??
    (
      await db
        .insert(buyer)
        .values({
          company_name: company,
          trade,
          email,
          phone: phone ?? null,
          city: city || null,
          lng: coords?.[0] ?? null,
          lat: coords?.[1] ?? null,
        })
        .returning()
    )[0];
  // A returning claimer who added their mobile this time keeps it on file
  // (it's the sheet-letter placeholder AND the SMS-login key).
  if (existing && phone && !existing.phone) {
    await db.update(buyer).set({ phone }).where(eq(buyer.id, existing.id));
  }

  if (!existing) {
    alertOperatorOfSignup({ company, email, trade, city: city || null, via: "claim" }).catch(() => {});
  }

  const claimed = await tryFreeUnlock(row.id, claim.property_id, co?.name ?? null, claim.company);
  // Funnel step 2: they submitted the profile form (the drop we couldn't see
  // before). `submit_unlocked` = the free lead was theirs; `submit_offer` = they
  // signed up but the specific lead was already gone (waterfall to next). Best-
  // effort; must never block the signup.
  db.insert(claimEvent)
    .values({
      company: claim.company ?? company,
      property_id: claim.property_id,
      trade,
      event: claimed ? "submit_unlocked" : "submit_offer",
    })
    .catch(() => {});

  // Stitch the journey: the claim token carries the company we pitched, so
  // the prospect profile links to the account it became (and the signup name
  // links too, when they typed something different).
  await linkCompanyToBuyer(claim.company, row.id);
  if (companyKeyOf(company) !== companyKeyOf(claim.company ?? "")) {
    await linkCompanyToBuyer(company, row.id);
  }

  cookies().set(BUYER_COOKIE, signBuyerSession(row.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: BUYER_SESSION_MAX_AGE,
    path: "/",
  });
  // The emailed lead filled before they got here? Land them on the waterfall
  // view: "that one went to other companies — here's the next best near you,"
  // with their free sheet still claimable where policy allows. Never a silent
  // plain dashboard after a scarcity promise.
  redirect(claimed ? `/buyers?claimed=${claim.property_id}` : `/buyers?offer=${claim.property_id}`);
}

/**
 * Claim-link tap from a browser that already holds a buyer session: no form,
 * no retyping the profile they already have. The session identifies the
 * buyer, the token identifies the lead — same unlock rules and journey
 * stitching as a fresh signup, same landing either way.
 */
export async function claimAsExistingBuyer(token: string): Promise<void> {
  const claim = verifyBuyerClaim(token);
  if (!claim) redirect("/buyers/login?expired=1");
  const buyerId = await currentBuyerId();
  // Session evaporated between render and tap — fall back to the form.
  if (!buyerId) redirect(`/buyers/claim/${token}`);
  // Same abuse posture as the form path (which is IP-limited).
  const rl = await rateLimit(`buyerclaim:buyer:${buyerId}`, 10, 3600);
  if (!rl.ok) redirect("/buyers");
  // A signed cookie for a deleted buyer row must bounce to login, not FK-500
  // inside the unlock insert.
  const [me] = await db.select().from(buyer).where(eq(buyer.id, buyerId!)).limit(1);
  if (!me) redirect("/buyers/login");
  const co = await getDefaultCompany();
  const claimed = await tryFreeUnlock(buyerId!, claim.property_id, co?.name ?? null, claim.company);
  // Journey stitching ONLY when the link plausibly belongs to this buyer — a
  // forwarded/shared link must not mark someone ELSE's prospect company as
  // converted (that would silently pull them out of the outreach machines).
  if (claim.company && companyKeyOf(claim.company) === companyKeyOf(me.company_name)) {
    await linkCompanyToBuyer(claim.company, buyerId!);
  }
  redirect(claimed ? `/buyers?claimed=${claim.property_id}` : `/buyers?offer=${claim.property_id}`);
}

/**
 * Public signup (homepage): same 3-field profile, no campaign token and no
 * lead attached — the buyer picks their free first sheet from the dashboard.
 * SECURITY: an existing email gets routed to the magic-link login instead of
 * a fresh session — otherwise typing someone's address would hand over their
 * account. (Claim-token signups may reuse the row: token possession is proof.)
 */
export async function createBuyerAccount(formData: FormData): Promise<void> {
  const email = ((formData.get("email") as string) || "").trim().toLowerCase();
  const company = ((formData.get("company") as string) || "").trim();
  const city = ((formData.get("city") as string) || "").trim();
  const trade = asTrade(formData.get("trade"));
  // Residential-pitch signups land on the marketplace they were sold on.
  const respkg = /^[0-9a-f-]{36}$/i.test((formData.get("respkg") as string) ?? "");
  if (!email.includes("@") || !company) redirect("/buyers/signup?error=1");

  const rl = await rateLimit(`buyersignup:ip:${clientIp()}`, 10, 3600);
  if (!rl.ok) redirect("/buyers/signup?error=1");

  const [existing] = await db.select().from(buyer).where(eq(buyer.email, email)).limit(1);
  if (existing) redirect("/buyers/login?exists=1");

  const coords = city ? await geocodeAddress(`${city}, TX`, "place,address,poi") : null;
  const [row] = await db
    .insert(buyer)
    .values({
      company_name: company,
      trade,
      email,
      city: city || null,
      lng: coords?.[0] ?? null,
      lat: coords?.[1] ?? null,
    })
    .returning();

  alertOperatorOfSignup({ company, email, trade, city: city || null, via: "signup" }).catch(() => {});

  cookies().set(BUYER_COOKIE, signBuyerSession(row.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: BUYER_SESSION_MAX_AGE,
    path: "/",
  });
  redirect(respkg ? "/buyers/residential" : "/buyers");
}

/**
 * "Your first sheet is free" from the dashboard (organic signups have no
 * campaign token). Same guards as the token path, but failures surface as a
 * banner instead of silently no-oping.
 */
export async function claimFreeLead(propertyId: string): Promise<void> {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const fail = (msg: string): never => redirect(`/buyers?err=${encodeURIComponent(msg)}`);

  const [priorFree] = await db
    .select()
    .from(leadUnlock)
    .where(and(eq(leadUnlock.buyer_id, buyerId!), eq(leadUnlock.kind, "free")))
    .limit(1);
  if (priorFree) fail("Your free sheet has been used — this one would be a paid unlock.");

  // Same gates as paid checkout: suppressed accounts can't consume inventory,
  // and claims are rate-limited (each burns a sellable spot + a dossier build).
  const [meCheck] = await db.select().from(buyer).where(eq(buyer.id, buyerId!)).limit(1);
  if (meCheck) {
    const [sup] = await db
      .select()
      .from(suppression)
      .where(eq(suppression.email, meCheck.email))
      .limit(1);
    if (sup) fail("This account can't make claims. Contact support via the chat.");
  }
  const rl = await rateLimit(`freeclaim:buyer:${buyerId}`, 10, 3600);
  if (!rl.ok) fail("Too many attempts — try again in a bit.");

  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  // Sellable = measured (parcel) OR a public-bid lead (RFPs never have a
  // parcel — the solicitation itself is the deliverable). Must match the
  // shelf rule in lib/leads/market.ts or listed leads become dead ends.
  if (!prop || (!prop.parcel_geojson && leadKind(prop.name) !== "rfp"))
    fail("This lead isn't ready for sale yet — check back soon.");
  const myTrade = asTrade(meCheck?.trade);
  const avail = await leadAvailability(prop!, myTrade);
  if (!avail.open) fail("This one just sold out.");

  // Inventory-aware free-claim policy (lib/leads/allocation): fresh and
  // headline jobs stay paid, the free tap closes when the shelf runs thin.
  // Scoped to the buyer's trade — each trade has its own shelf and spots.
  const market = await loadMarketLeads(myTrade);
  const marketLead = market.find((l) => l.p.id === propertyId);
  if (!marketLead) fail("This one just sold out.");
  const verdict = freeVerdict(marketLead!, marketFreeContext(market));
  if (!verdict.allowed) {
    fail(`Free claim isn't open on this job — ${verdict.reason} You can still unlock it as a paid sheet.`);
  }

  const co = await getDefaultCompany();
  const [meRow] = await db.select().from(buyer).where(eq(buyer.id, buyerId!)).limit(1);
  const meLoc: [number, number] | null =
    meRow?.lng != null && meRow?.lat != null ? [meRow.lng, meRow.lat] : null;
  const dossier = co ? await buildDossier(prop!, co.name, meLoc).catch(() => null) : null;
  const [unlock] = await db
    .insert(leadUnlock)
    .values({ buyer_id: buyerId!, property_id: prop!.id, kind: "free", trade: myTrade, price_cents: 0, dossier, cycle: prop!.sale_cycle })
    .onConflictDoNothing({ target: [leadUnlock.property_id, leadUnlock.buyer_id, leadUnlock.trade, leadUnlock.cycle] })
    .returning();
  if (!unlock) fail("You already have this lead — it's in your unlocked list.");
  if (!(await confirmUnlockWithinCap(unlock.id, prop!.id))) {
    fail("The last spot just went to another company.");
  }
  // Race guard for the PER-BUYER free cap (two tabs, two different leads):
  // re-read all of this buyer's free unlocks; only the earliest survives.
  const myFree = await db
    .select()
    .from(leadUnlock)
    .where(and(eq(leadUnlock.buyer_id, buyerId!), eq(leadUnlock.kind, "free")));
  myFree.sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id));
  if (myFree.length > 1 && myFree[0].id !== unlock.id) {
    await db.delete(leadUnlock).where(eq(leadUnlock.id, unlock.id));
    fail("Your free sheet has been used — this one would be a paid unlock.");
  }
  await closeLeadIfDone(prop!.id);
  waitUntil(alertLastSpot(prop!.id));
  // ?claimed= triggers the exclusive-upgrade upsell at peak-belief moment.
  redirect(`/buyers?claimed=${prop!.id}`);
}

/**
 * Free unlock, guarded: shared spot open, lead is sellable (has a parcel to
 * measure), one free claim per buyer, and races resolve gracefully instead of
 * crashing the signup. Failures are silent — the buyer still gets their
 * profile and dashboard.
 */
async function tryFreeUnlock(
  buyerId: string,
  propertyId: string,
  brand: string | null,
  claimCompany?: string | null
): Promise<boolean> {
  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop || (!prop.parcel_geojson && leadKind(prop.name) !== "rfp")) return false;
  const [buyerRow] = await db.select().from(buyer).where(eq(buyer.id, buyerId)).limit(1);
  // Suppressed companies can't consume inventory through a claim token —
  // same gate as the marketplace free-claim and paid checkout.
  if (buyerRow) {
    const [sup] = await db
      .select()
      .from(suppression)
      .where(eq(suppression.email, buyerRow.email))
      .limit(1);
    if (sup) return false;
  }
  const buyerLoc: [number, number] | null =
    buyerRow?.lng != null && buyerRow?.lat != null ? [buyerRow.lng, buyerRow.lat] : null;

  const myTrade = asTrade(buyerRow?.trade);
  const avail = await leadAvailability(prop, myTrade);
  if (!avail.open) return false;

  // Campaign tokens bypass the marketplace free-claim policy on purpose — the
  // operator chose this lead as the acquisition hook — but the per-lead free
  // budget (per trade) still holds so paid capacity is never fully given away.
  const freeOnLead = (
    await db
      .select()
      .from(leadUnlock)
      .where(and(eq(leadUnlock.property_id, propertyId), eq(leadUnlock.kind, "free")))
  ).filter((u) => u.trade === myTrade);
  if (freeOnLead.length >= FREE_MAX_PER_LEAD) return false;

  // The free spot may be HELD for another company (24h loss-aversion hold).
  // The intended holder is the claim token's company (the one we pitched) —
  // the same key the hold was placed under — so their own claim always passes;
  // a DIFFERENT company can't take a spot reserved for someone else.
  const holderKey = claimCompany ? companyKeyOf(claimCompany) : null;
  if (heldByOther(await liveHold(propertyId, myTrade), holderKey)) return false;

  // "Your first sheet is free" — once per company, not once per campaign email.
  const [priorFree] = await db
    .select()
    .from(leadUnlock)
    .where(and(eq(leadUnlock.buyer_id, buyerId), eq(leadUnlock.kind, "free")))
    .limit(1);
  if (priorFree) return false;

  // The dossier build touches TABS/Mapbox/county services — a hiccup there
  // must not 500 the signup. A null dossier is visible on /buyers as "being
  // prepared" and in the operator's court.
  const dossier = brand ? await buildDossier(prop, brand, buyerLoc).catch(() => null) : null;

  const [unlock] = await db
    .insert(leadUnlock)
    .values({ buyer_id: buyerId, property_id: prop.id, kind: "free", trade: myTrade, price_cents: 0, dossier, cycle: prop.sale_cycle })
    .onConflictDoNothing({ target: [leadUnlock.property_id, leadUnlock.buyer_id, leadUnlock.trade, leadUnlock.cycle] })
    .returning();
  if (!unlock) return true; // this buyer already holds this lead — that's a win

  // No-transaction race guard: roll back if we landed over the cap.
  if (!(await confirmUnlockWithinCap(unlock.id, prop.id))) return false;
  // Race guard for the PER-BUYER free cap (two concurrent claims on two
  // DIFFERENT properties both pass the priorFree pre-check): re-read all of
  // this buyer's free unlocks; only the earliest survives — same rule as
  // claimFreeLead.
  const myFree = await db
    .select()
    .from(leadUnlock)
    .where(and(eq(leadUnlock.buyer_id, buyerId), eq(leadUnlock.kind, "free")));
  myFree.sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id));
  if (myFree.length > 1 && myFree[0].id !== unlock.id) {
    await db.delete(leadUnlock).where(eq(leadUnlock.id, unlock.id));
    return false;
  }
  // They claimed it — the hold has done its job; release it.
  await releaseHold(propertyId, myTrade);
  await closeLeadIfDone(prop.id);
  waitUntil(alertLastSpot(prop.id));
  return true;
}

/** Returning buyers without a (real) email: text a magic link. The signed
 *  token carries the buyer's stored email (placeholder or real), so the
 *  existing /buyers/verify flow handles it unchanged. Anti-enumeration: the
 *  page always says "check your phone". */
export async function requestBuyerSmsLink(formData: FormData): Promise<void> {
  const phone = toE164((formData.get("phone") as string) || "");
  if (!phone) redirect("/buyers/login?error=1");
  const rl = await rateLimit(`buyerlogin:ip:${clientIp()}`, 10, 3600);
  if (rl.ok) {
    const [row] = await db
      .select()
      .from(buyer)
      .where(or(eq(buyer.phone, phone!), eq(buyer.email, phonePlaceholderEmail(phone!))))
      .limit(1);
    if (row) {
      const co = await getDefaultCompany();
      const link = `${baseUrl()}/buyers/verify?token=${encodeURIComponent(signBuyerLogin(row.email))}`;
      const res = await sendSms({
        to: phone!,
        body: `Your ${co?.name ?? "Greenkeep"} sign-in link (expires in 30 min): ${link}`,
        kind: "login_link",
        buyerId: row.id,
      });
      if (!res.ok) console.error(`buyer SMS login link FAILED for ${phone}: ${res.error}`);
    }
  }
  redirect("/buyers/login?sms=1");
}

/** Returning buyers: email a magic link. Never reveals whether an email exists. */
export async function requestBuyerLink(formData: FormData): Promise<void> {
  const email = ((formData.get("email") as string) || "").trim().toLowerCase();
  if (!email.includes("@")) redirect("/buyers/login?error=1");
  const rl = await rateLimit(`buyerlogin:ip:${clientIp()}`, 10, 3600);
  if (rl.ok) {
    const [row] = await db.select().from(buyer).where(eq(buyer.email, email)).limit(1);
    if (row) {
      const link = `${baseUrl()}/buyers/verify?token=${encodeURIComponent(signBuyerLogin(email))}`;
      const co = await getDefaultCompany();
      const res = await sendEmail({
        to: email,
        subject: `Your ${co?.name ?? "Greenkeep"} sign-in link`,
        html: magicLinkEmail({
          brand: co?.name ?? "Greenkeep",
          heading: "Sign in to your job-leads dashboard",
          intro: "One tap and you're in — no password needed. This link expires in 30 minutes.",
          buttonLabel: "Open my dashboard",
          link,
          footnote: "Didn't request this? You can safely ignore it — nobody can sign in without this email.",
        }),
      });
      // The page must stay anti-enumeration (always "check your inbox"), so
      // the ONLY place a failed magic-link send is visible is the server log.
      if (!res.ok) console.error(`buyer login link send FAILED for ${email}: ${res.error}`);
      else console.log(`buyer login link sent to ${email} (resend id ${res.id ?? "?"})`);
    }
  }
  redirect("/buyers/login?sent=1");
}

/** Update the landscaper profile (auto-fills their outreach letters + anchors
 *  the service-radius map to their office). */
export async function updateBuyerProfile(formData: FormData): Promise<void> {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const s = (k: string) => ((formData.get(k) as string) || "").trim().slice(0, 300) || null;
  const company = s("company_name");
  const address = s("address");
  const city = s("city");
  const radius = Math.max(2, Math.min(60, Math.round(Number(formData.get("service_radius_mi")) || 25)));
  const [me] = await db.select().from(buyer).where(eq(buyer.id, buyerId!)).limit(1);

  // Geocode the office ADDRESS (precise) when it changed; fall back to city.
  // The precise geocode also yields the return ZIP for mailed postcards.
  let coords: [number, number] | null = null;
  let zip: string | null | undefined = undefined;
  if (address && address !== me?.address) {
    const g = await geocodeWithZip(`${address}, ${city ?? "TX"}`, "address,poi");
    if (g) {
      coords = [g.lng, g.lat];
      zip = g.zip;
    }
  } else if (!me?.lat && city) {
    coords = await geocodeAddress(`${city}, TX`, "place,address,poi");
  }

  await db
    .update(buyer)
    .set({
      company_name: company || me?.company_name || "My company",
      contact_name: s("contact_name"),
      phone: s("phone"),
      website: s("website"),
      license_number: s("license_number"),
      address,
      city,
      service_radius_mi: radius,
      bio: s("bio"),
      ...(coords ? { lng: coords[0], lat: coords[1] } : {}),
      ...(zip !== undefined ? { zip } : {}),
      updated_at: new Date(),
    })
    .where(eq(buyer.id, buyerId!));
  revalidatePath("/buyers");
  revalidatePath("/buyers/profile");
  redirect("/buyers/profile?saved=1");
}

/** Mark the dashboard alert feed as read (clears the unread badge/dots). */
export async function markAlertsSeen(): Promise<void> {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  await db
    .update(buyer)
    .set({ alerts_seen_at: new Date(), updated_at: new Date() })
    .where(eq(buyer.id, buyerId!));
  revalidatePath("/buyers");
}

export async function buyerLogout(): Promise<void> {
  cookies().delete(BUYER_COOKIE);
  redirect("/buyers/login");
}

export async function toggleNotifications(value: boolean): Promise<void> {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  await db.update(buyer).set({ notify: value, updated_at: new Date() }).where(eq(buyer.id, buyerId));
  redirect("/buyers");
}

/** First Look subscription checkout: $/mo for the 24h early-access window. */
export async function startFirstLookCheckout(): Promise<void> {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const [row] = await db.select().from(buyer).where(eq(buyer.id, buyerId)).limit(1);
  if (!row) redirect("/buyers/login");
  const fail = (msg: string): never => redirect(`/buyers?err=${encodeURIComponent(msg)}`);
  const [supp] = await db.select().from(suppression).where(eq(suppression.email, row.email)).limit(1);
  if (supp) fail("This account can't make purchases — contact us.");
  const base = baseUrl();
  const res = await createFirstLookCheckout({
    amountCents: firstLookPriceCents(),
    buyerEmail: row.email,
    buyerId: row.id,
    successUrl: `${base}/buyers?firstlook=1`,
    cancelUrl: `${base}/buyers`,
  });
  if (!res.ok) fail(res.error);
  redirect((res as { ok: true; url: string }).url);
}

/**
 * Exclusive UPGRADE: a buyer who already holds a lead (free or paid) and is
 * still its ONLY holder in their trade pays the exclusive premium (minus what
 * they already paid) to close it to competitors. Fulfilled by the Stripe
 * webhook flipping their existing unlock's kind — with a sole-holder re-check
 * there, since someone can join between checkout and payment (credit on
 * conflict, the standing no-refund pattern). "Yours alone" stays honest:
 * upgrading is only offered while no other company ever held the sheet.
 */
export async function startExclusiveUpgrade(propertyId: string): Promise<void> {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const [row] = await db.select().from(buyer).where(eq(buyer.id, buyerId!)).limit(1);
  if (!row) redirect("/buyers/login");
  const fail = (msg: string): never => redirect(`/buyers?err=${encodeURIComponent(msg)}`);

  const rl = await rateLimit(`buyercheckout:ip:${clientIp()}`, 20, 3600);
  if (!rl.ok) fail("Too many attempts — try again in a bit.");

  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop || prop!.archived_at) fail("Lead not found.");

  const all = (
    await db.select().from(leadUnlock).where(eq(leadUnlock.property_id, propertyId))
  ).filter((u) => u.trade === asTrade(row!.trade));
  const mine = all.find((u) => u.buyer_id === row!.id);
  if (!mine) fail("You don't hold this lead.");
  if (mine!.kind === "exclusive") fail("This job is already exclusively yours.");
  if (all.length > 1)
    fail("Another company already shares this lead, so the exclusive option is gone.");

  const kindOfLead = leadKind(prop!.name);
  const est = TRADES[asTrade(row!.trade)].estimateValue(tradeValueInput(prop!, kindOfLead));
  const tier = leadTierFor(est?.annualHi ?? null, kindOfLead);
  // Credit what they already paid toward the exclusive price.
  const amount = Math.max(tier.exclusive_cents - (mine!.kind === "paid" ? tier.price_cents : 0), 500);

  const base = baseUrl();
  const res = await createLeadCheckout({
    amountCents: amount,
    leadName: `exclusive upgrade — ${kindOfLead} lead`,
    buyerEmail: row!.email,
    buyerId: row!.id,
    propertyId,
    kind: "exclusive",
    upgradeUnlockId: mine!.id,
    successUrl: `${base}/buyers?unlocked=1`,
    cancelUrl: `${base}/buyers?claimed=${propertyId}`,
  });
  if (!res.ok) fail(res.error);
  redirect((res as { ok: true; url: string }).url);
}

/**
 * Stripe unlock: pay -> webhook reveals the lead. `kind` "paid" buys one of
 * the shared spots; "exclusive" (premium) closes the lead — only offered while
 * nobody else has it. Errors land as a dashboard banner.
 */
export async function startCheckout(propertyId: string, kind: "paid" | "exclusive"): Promise<void> {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const [row] = await db.select().from(buyer).where(eq(buyer.id, buyerId)).limit(1);
  if (!row) redirect("/buyers/login");

  const fail = (msg: string): never => redirect(`/buyers?err=${encodeURIComponent(msg)}`);

  const rl = await rateLimit(`buyercheckout:ip:${clientIp()}`, 20, 3600);
  if (!rl.ok) fail("Too many attempts — try again in a bit.");

  const [supp] = await db.select().from(suppression).where(eq(suppression.email, row.email)).limit(1);
  if (supp) fail("This account can't make purchases — contact us.");

  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop) fail("Lead not found.");
  if (!prop!.parcel_geojson && leadKind(prop!.name) !== "rfp")
    fail("This lead isn't ready for sale yet — check back soon.");

  const avail = await leadAvailability(prop!, asTrade(row.trade));
  if (avail.closed) fail("This one just sold out.");
  if (kind === "exclusive" && !avail.exclusiveOpen)
    fail("Another company already has this lead, so the exclusive option is gone — a shared spot is still open.");

  const [mine] = await db
    .select()
    .from(leadUnlock)
    .where(and(eq(leadUnlock.property_id, propertyId), eq(leadUnlock.buyer_id, row.id)))
    .limit(1);
  if (mine) fail("You already have this lead — it's in your unlocked list.");

  // Value-based tier keyed to THIS BUYER'S TRADE's estimate — the memo, the
  // shelf card, and this checkout all quote the same per-trade price.
  const kindOfLead = leadKind(prop!.name);
  const est = TRADES[asTrade(row.trade)].estimateValue(tradeValueInput(prop!, kindOfLead));
  const tier = leadTierFor(est?.annualHi ?? null, kindOfLead);

  // Account credit (replacement-lead policy) covers it? Unlock right here — no
  // card, no Stripe. Credit is deducted atomically first (guards double-spend
  // across tabs) and restored if the unlock loses a race.
  const amount = kind === "exclusive" ? tier.exclusive_cents : tier.price_cents;
  if (row.credit_cents >= amount) {
    const [debited] = await db
      .update(buyer)
      .set({ credit_cents: sql`${buyer.credit_cents} - ${amount}`, updated_at: new Date() })
      .where(and(eq(buyer.id, row.id), gte(buyer.credit_cents, amount)))
      .returning();
    if (debited) {
      const co = await getDefaultCompany();
      const rowLoc: [number, number] | null =
        row.lng != null && row.lat != null ? [row.lng, row.lat] : null;
      const dossier = co ? await buildDossier(prop!, co.name, rowLoc).catch(() => null) : null;
      const recredit = () =>
        db
          .update(buyer)
          .set({ credit_cents: sql`${buyer.credit_cents} + ${amount}`, updated_at: new Date() })
          .where(eq(buyer.id, row.id));
      const [unlock] = await db
        .insert(leadUnlock)
        .values({ buyer_id: row.id, property_id: propertyId, kind, trade: asTrade(row.trade), price_cents: amount, dossier, cycle: prop!.sale_cycle })
        .onConflictDoNothing({ target: [leadUnlock.property_id, leadUnlock.buyer_id, leadUnlock.trade, leadUnlock.cycle] })
        .returning();
      if (!unlock) {
        await recredit();
        fail("You already have this lead — it's in your unlocked list.");
      }
      if (!(await confirmUnlockWithinCap(unlock!.id, propertyId))) {
        await recredit();
        fail("The last spot just went to another company — your credit is untouched.");
      }
      await closeLeadIfDone(propertyId);
      waitUntil(alertLastSpot(propertyId));
      redirect("/buyers?unlocked=1");
    }
  }

  const base = baseUrl();
  const res = await createLeadCheckout({
    amountCents: amount,
    // NEVER the property name: for transfer/violation leads the name IS the
    // street address — the paid content — and Stripe shows the line item
    // before payment. Teaser-safe label only.
    leadName: `Job sheet — ${prop!.city ?? "Houston"} area ${
      { rfp: "public-bid", distress: "distressed-property" }[leadKind(prop!.name) as string] ??
      leadKind(prop!.name)
    } lead`,
    buyerEmail: row.email,
    buyerId: row.id,
    propertyId,
    kind,
    successUrl: `${base}/buyers?unlocked=1`,
    cancelUrl: `${base}/buyers?canceled=1`,
  });
  if (!res.ok) fail(res.error);
  redirect((res as { ok: true; url: string }).url);
}

// --- chat -------------------------------------------------------------------

async function notifyOperatorOfChat(from: string, body: string): Promise<void> {
  const co = await getDefaultCompany();
  if (!co?.email) return; // no operator inbox configured — message waits in /messages
  await sendEmail({
    to: co.email,
    subject: `New buyer message — ${from}`,
    html: `<p><strong>${from}</strong> wrote:</p><blockquote>${body
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")}</blockquote><p><a href="${baseUrl()}/messages">Reply from the operator dashboard</a></p>`,
    tags: { kind: "chat_operator" },
  }).catch(() => null);
}

/** Signed-in buyer sends a chat message (widget on the buyer portal). */
export async function sendChatMessage(formData: FormData): Promise<void> {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const body = ((formData.get("body") as string) || "").trim().slice(0, 2000);
  if (!body) return;
  const rl = await rateLimit(`chat:buyer:${buyerId}`, 30, 3600);
  if (!rl.ok) return;
  const [me] = await db.select().from(buyer).where(eq(buyer.id, buyerId!)).limit(1);
  if (!me) redirect("/buyers/login");
  await db.insert(chatMessage).values({ buyer_id: me.id, sender: "buyer", body });
  await notifyOperatorOfChat(`${me.company_name} (${me.email})`, body);
  revalidatePath("/buyers");
}

/**
 * Anonymous chat (homepage widget): email + message. Finds or creates the
 * buyer row by email but NEVER mints a session — an existing buyer's account
 * can't be hijacked by typing their address. Replies arrive by email.
 * Chat-created profiles start with alerts OFF (they only asked a question).
 */
export async function startChat(formData: FormData): Promise<{ ok: boolean }> {
  const email = ((formData.get("email") as string) || "").trim().toLowerCase();
  const body = ((formData.get("body") as string) || "").trim().slice(0, 2000);
  if (!email.includes("@") || !body) return { ok: false };
  const rl = await rateLimit(`chat:ip:${clientIp()}`, 10, 3600);
  if (!rl.ok) return { ok: false };

  const [existing] = await db.select().from(buyer).where(eq(buyer.email, email)).limit(1);
  const row =
    existing ??
    (
      await db
        .insert(buyer)
        .values({ company_name: email.split("@")[0], email, notify: false })
        .returning()
    )[0];
  await db.insert(chatMessage).values({ buyer_id: row.id, sender: "buyer", body });
  await notifyOperatorOfChat(email, body);
  return { ok: true };
}

// --- outreach tracker -------------------------------------------------------

const OUTREACH_STATUSES = [
  "new",
  "letter_sent",
  "postcard_sent",
  "contacted",
  "bidding",
  "won",
  "lost",
] as const;
type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  letter_sent: "Letter sent",
  postcard_sent: "Postcard mailed",
  contacted: "Contacted",
  bidding: "Bidding",
  won: "Won",
  lost: "Lost",
};

/** Advance/set a buyer's outreach status on one of their unlocked leads. */
export async function setLeadStatus(unlockId: string, status: string): Promise<void> {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  if (!OUTREACH_STATUSES.includes(status as OutreachStatus)) return;
  const [u] = await db
    .select()
    .from(leadUnlock)
    .where(and(eq(leadUnlock.id, unlockId), eq(leadUnlock.buyer_id, buyerId!)))
    .limit(1);
  if (!u || u.outreach_status === status) return;
  await db.update(leadUnlock).set({ outreach_status: status, updated_at: new Date() }).where(eq(leadUnlock.id, unlockId));
  await db.insert(leadActivity).values({
    unlock_id: unlockId,
    kind: "status",
    detail: `Moved to ${STATUS_LABEL[status] ?? status}`,
  });
  revalidatePath(`/buyers/leads/${unlockId}`);
  revalidatePath("/buyers");
}

/** Add a free-text note to a lead's timeline. */
export async function addLeadNote(unlockId: string, formData: FormData): Promise<void> {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const body = ((formData.get("note") as string) || "").trim().slice(0, 1000);
  if (!body) return;
  const [u] = await db
    .select({ id: leadUnlock.id })
    .from(leadUnlock)
    .where(and(eq(leadUnlock.id, unlockId), eq(leadUnlock.buyer_id, buyerId!)))
    .limit(1);
  if (!u) return;
  await db.insert(leadActivity).values({ unlock_id: unlockId, kind: "note", detail: body });
  revalidatePath(`/buyers/leads/${unlockId}`);
}

// --- logo upload (Vercel Blob) ----------------------------------------------

export async function uploadBuyerLogo(formData: FormData): Promise<void> {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const file = formData.get("logo") as File | null;
  if (!file || file.size === 0) redirect("/buyers/profile?logoerr=1");
  if (file.size > 3_000_000) redirect("/buyers/profile?logoerr=toobig");
  if (!/^image\/(png|jpe?g|svg\+xml|webp)$/.test(file.type)) redirect("/buyers/profile?logoerr=type");
  // No Blob store linked → the token is absent at runtime. Report that precisely
  // (a real store must be CREATED in Vercel; adding the var name alone won't do).
  if (!process.env.BLOB_READ_WRITE_TOKEN) redirect("/buyers/profile?logoerr=upload");

  let url: string;
  try {
    const { put } = await import("@vercel/blob");
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const blob = await put(`logos/${buyerId}-${Date.now()}.${ext}`, file, {
      access: "public",
      contentType: file.type,
    });
    url = blob.url;
  } catch (e) {
    // A configured store that still failed — log the real cause for diagnosis.
    console.error("[uploadBuyerLogo] blob put failed:", e instanceof Error ? e.message : e);
    redirect("/buyers/profile?logoerr=failed");
  }
  await db.update(buyer).set({ logo_url: url, updated_at: new Date() }).where(eq(buyer.id, buyerId!));
  revalidatePath("/buyers/profile");
  revalidatePath("/buyers");
  redirect("/buyers/profile?saved=1");
}

// --- postcard checkout ------------------------------------------------------

/** Pay to have Greenkeep print + mail a branded postcard to the lead's owner. */
export async function startPostcardCheckout(unlockId: string): Promise<void> {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const back = (msg: string): never => redirect(`/buyers/leads/${unlockId}?perr=${encodeURIComponent(msg)}`);

  const [row] = await db.select().from(leadUnlock).where(and(eq(leadUnlock.id, unlockId), eq(leadUnlock.buyer_id, buyerId!))).limit(1);
  if (!row) back("Lead not found.");
  const [me] = await db.select().from(buyer).where(eq(buyer.id, buyerId!)).limit(1);
  if (!me) redirect("/buyers/login");
  if (!me.address || !me.city) back("Add your office address in your profile first — it's the postcard's return address.");

  const rl = await rateLimit(`postcard:ip:${clientIp()}`, 20, 3600);
  if (!rl.ok) back("Too many attempts — try again in a bit.");

  const base = baseUrl();
  const { postcardPriceCents, createPostcardCheckout } = await import("@/lib/integrations/stripe");
  const res = await createPostcardCheckout({
    amountCents: postcardPriceCents(),
    leadName: (row!.dossier as { name?: string } | null)?.name ?? "owner",
    buyerEmail: me.email,
    buyerId: me.id,
    unlockId,
    successUrl: `${base}/buyers/leads/${unlockId}?mailed=1`,
    cancelUrl: `${base}/buyers/leads/${unlockId}?canceled=1`,
  });
  if (!res.ok) back(res.error);
  redirect((res as { ok: true; url: string }).url);
}
