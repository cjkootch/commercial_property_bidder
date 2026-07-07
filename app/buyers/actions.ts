"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, leadUnlock, property, suppression } from "@/lib/db/schema";
import {
  BUYER_COOKIE,
  BUYER_SESSION_MAX_AGE,
  signBuyerLogin,
  signBuyerSession,
  verifyBuyerClaim,
  verifyBuyerSession,
} from "@/lib/buyer-auth";
import { buildDossier } from "@/lib/leads/dossier";
import {
  closeLeadIfDone,
  confirmUnlockWithinCap,
  leadAvailability,
} from "@/lib/leads/availability";
import { createLeadCheckout, exclusivePriceCents, leadPriceCents } from "@/lib/integrations/stripe";
import { geocodeAddress } from "@/lib/integrations/geocoding";
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
 * Free unlock, guarded: shared spot open, lead is sellable (has a parcel to
 * measure), one free claim per buyer, and races resolve gracefully instead of
 * crashing the signup. Failures are silent — the buyer still gets their
 * profile and dashboard.
 */
async function tryFreeUnlock(buyerId: string, propertyId: string, brand: string | null): Promise<void> {
  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop || !prop.parcel_geojson) return;

  const avail = await leadAvailability(prop);
  if (!avail.open) return;

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
  const dossier = brand ? await buildDossier(prop, brand).catch(() => null) : null;

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

  // Account credit (replacement-lead policy) covers it? Unlock right here — no
  // card, no Stripe. Credit is deducted atomically first (guards double-spend
  // across tabs) and restored if the unlock loses a race.
  const amount = kind === "exclusive" ? exclusivePriceCents() : leadPriceCents();
  if (row.credit_cents >= amount) {
    const [debited] = await db
      .update(buyer)
      .set({ credit_cents: sql`${buyer.credit_cents} - ${amount}`, updated_at: new Date() })
      .where(and(eq(buyer.id, row.id), gte(buyer.credit_cents, amount)))
      .returning();
    if (debited) {
      const co = await getDefaultCompany();
      const dossier = co ? await buildDossier(prop!, co.name).catch(() => null) : null;
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
    leadName: prop!.name.replace(/ \(TABS [^)]+\)$/, ""),
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
