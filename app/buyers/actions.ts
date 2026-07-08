"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, chatMessage, leadActivity, leadUnlock, property, suppression } from "@/lib/db/schema";
import {
  BUYER_COOKIE,
  BUYER_SESSION_MAX_AGE,
  signBuyerLogin,
  signBuyerSession,
  verifyBuyerClaim,
  verifyBuyerSession,
} from "@/lib/buyer-auth";
import { buildDossier } from "@/lib/leads/dossier";
import { FREE_MAX_PER_LEAD } from "@/lib/leads/allocation";
import { freeVerdict, leadKind, loadMarketLeads, marketFreeContext } from "@/lib/leads/market";
import {
  closeLeadIfDone,
  confirmUnlockWithinCap,
  leadAvailability,
} from "@/lib/leads/availability";
import { createLeadCheckout } from "@/lib/integrations/stripe";
import { leadTierFor } from "@/lib/leads/pricing-tiers";
import { geocodeAddress, geocodeWithZip } from "@/lib/integrations/geocoding";
import { sendEmail } from "@/lib/integrations/resend";
import { getDefaultCompany } from "@/lib/db/queries";
import { rateLimit, clientIp, LIMITS } from "@/lib/ratelimit";

function baseUrl(): string {
  const envBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (envBase && !/localhost|127\.0\.0\.1/.test(envBase)) return envBase;
  const host = headers().get("host");
  return host ? `https://${host}` : "https://greenkeep.us";
}

export async function currentBuyerId(): Promise<string | null> {
  return verifyBuyerSession(cookies().get(BUYER_COOKIE)?.value);
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

  const email = ((formData.get("email") as string) || "").trim().toLowerCase();
  const company = ((formData.get("company") as string) || "").trim();
  const city = ((formData.get("city") as string) || "").trim();
  if (!email.includes("@") || !company) redirect(`/buyers/claim/${token}?error=1`);

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
          email,
          city: city || null,
          lng: coords?.[0] ?? null,
          lat: coords?.[1] ?? null,
        })
        .returning()
    )[0];

  await tryFreeUnlock(row.id, claim.property_id, co?.name ?? null);

  cookies().set(BUYER_COOKIE, signBuyerSession(row.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: BUYER_SESSION_MAX_AGE,
    path: "/",
  });
  redirect("/buyers");
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
      email,
      city: city || null,
      lng: coords?.[0] ?? null,
      lat: coords?.[1] ?? null,
    })
    .returning();

  cookies().set(BUYER_COOKIE, signBuyerSession(row.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: BUYER_SESSION_MAX_AGE,
    path: "/",
  });
  redirect("/buyers");
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
  if (!prop || !prop.parcel_geojson) fail("This lead isn't ready for sale yet — check back soon.");
  const avail = await leadAvailability(prop!);
  if (!avail.open) fail("This one just sold out.");

  // Inventory-aware free-claim policy (lib/leads/allocation): fresh and
  // headline jobs stay paid, the free tap closes when the shelf runs thin.
  const market = await loadMarketLeads();
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
    .values({ buyer_id: buyerId!, property_id: prop!.id, kind: "free", price_cents: 0, dossier })
    .onConflictDoNothing({ target: [leadUnlock.property_id, leadUnlock.buyer_id] })
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
  redirect("/buyers");
}

/**
 * Free unlock, guarded: shared spot open, lead is sellable (has a parcel to
 * measure), one free claim per buyer, and races resolve gracefully instead of
 * crashing the signup. Failures are silent — the buyer still gets their
 * profile and dashboard.
 */
async function tryFreeUnlock(buyerId: string, propertyId: string, brand: string | null): Promise<void> {
  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop || !prop.parcel_geojson) return;
  const [buyerRow] = await db.select().from(buyer).where(eq(buyer.id, buyerId)).limit(1);
  const buyerLoc: [number, number] | null =
    buyerRow?.lng != null && buyerRow?.lat != null ? [buyerRow.lng, buyerRow.lat] : null;

  const avail = await leadAvailability(prop);
  if (!avail.open) return;

  // Campaign tokens bypass the marketplace free-claim policy on purpose — the
  // operator chose this lead as the acquisition hook — but the per-lead free
  // budget still holds so paid capacity is never fully given away.
  const freeOnLead = await db
    .select()
    .from(leadUnlock)
    .where(and(eq(leadUnlock.property_id, propertyId), eq(leadUnlock.kind, "free")));
  if (freeOnLead.length >= FREE_MAX_PER_LEAD) return;

  // "Your first sheet is free" — once per company, not once per campaign email.
  const [priorFree] = await db
    .select()
    .from(leadUnlock)
    .where(and(eq(leadUnlock.buyer_id, buyerId), eq(leadUnlock.kind, "free")))
    .limit(1);
  if (priorFree) return;

  // The dossier build touches TABS/Mapbox/county services — a hiccup there
  // must not 500 the signup. A null dossier is visible on /buyers as "being
  // prepared" and in the operator's court.
  const dossier = brand ? await buildDossier(prop, brand, buyerLoc).catch(() => null) : null;

  const [unlock] = await db
    .insert(leadUnlock)
    .values({ buyer_id: buyerId, property_id: prop.id, kind: "free", price_cents: 0, dossier })
    .onConflictDoNothing({ target: [leadUnlock.property_id, leadUnlock.buyer_id] })
    .returning();
  if (!unlock) return; // this buyer already holds this lead

  // No-transaction race guard: roll back if we landed over the cap.
  if (!(await confirmUnlockWithinCap(unlock.id, prop.id))) return;
  await closeLeadIfDone(prop.id);
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
      await sendEmail({
        to: email,
        subject: `Your ${co?.name ?? "Greenkeep"} sign-in link`,
        html: `<p>Sign in to your job-leads dashboard:</p><p><a href="${link}">${link}</a></p><p>Link expires in 30 minutes.</p>`,
      });
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
  if (!prop!.parcel_geojson) fail("This lead isn't ready for sale yet — check back soon.");

  const avail = await leadAvailability(prop!);
  if (avail.closed) fail("This one just sold out.");
  if (kind === "exclusive" && !avail.exclusiveOpen)
    fail("Another company already has this lead, so the exclusive option is gone — a shared spot is still open.");

  const [mine] = await db
    .select()
    .from(leadUnlock)
    .where(and(eq(leadUnlock.property_id, propertyId), eq(leadUnlock.buyer_id, row.id)))
    .limit(1);
  if (mine) fail("You already have this lead — it's in your unlocked list.");

  // Value-based tier: the same lead always quotes the same price everywhere.
  const teaser = prop!.lead_teaser as { annual_hi?: number } | null;
  const tier = leadTierFor(teaser?.annual_hi ?? null, leadKind(prop!.name));

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
        .values({ buyer_id: row.id, property_id: propertyId, kind, price_cents: amount, dossier })
        .onConflictDoNothing({ target: [leadUnlock.property_id, leadUnlock.buyer_id] })
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
