"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
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
import { createLeadCheckout, leadPriceCents } from "@/lib/integrations/stripe";
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
 * snapshot) unless another company already claimed it — profile still gets
 * created so the buyer lands on the dashboard either way.
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

  // Unlock the free lead if it's still available (sold-once).
  const [prop] = await db.select().from(property).where(eq(property.id, claim.property_id)).limit(1);
  if (prop) {
    const [taken] = await db.select().from(leadUnlock).where(eq(leadUnlock.property_id, prop.id)).limit(1);
    if (!taken) {
      const dossier = co ? await buildDossier(prop, co.name) : null;
      await db.insert(leadUnlock).values({
        buyer_id: row.id,
        property_id: prop.id,
        kind: "free",
        price_cents: 0,
        dossier,
      });
      await db
        .update(property)
        .set({ lead_exported_at: new Date(), lead_buyer: row.company_name, updated_at: new Date() })
        .where(and(eq(property.id, prop.id), isNull(property.lead_exported_at)));
    }
  }

  cookies().set(BUYER_COOKIE, signBuyerSession(row.id), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: BUYER_SESSION_MAX_AGE,
    path: "/",
  });
  redirect("/buyers");
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

/** Stripe unlock: pay -> webhook reveals the lead. Errors land as a banner. */
export async function startCheckout(propertyId: string): Promise<void> {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const [row] = await db.select().from(buyer).where(eq(buyer.id, buyerId)).limit(1);
  if (!row) redirect("/buyers/login");

  const fail = (msg: string): never => redirect(`/buyers?err=${encodeURIComponent(msg)}`);

  const [supp] = await db.select().from(suppression).where(eq(suppression.email, row.email)).limit(1);
  if (supp) fail("This account can't make purchases — contact us.");

  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop) fail("Lead not found.");
  const [taken] = await db.select().from(leadUnlock).where(eq(leadUnlock.property_id, propertyId)).limit(1);
  if (taken) fail("This one was just claimed by another company.");

  const base = baseUrl();
  const res = await createLeadCheckout({
    amountCents: leadPriceCents(),
    leadName: prop!.name.replace(/ \(TABS [^)]+\)$/, ""),
    buyerEmail: row.email,
    buyerId: row.id,
    propertyId,
    successUrl: `${base}/buyers?unlocked=1`,
    cancelUrl: `${base}/buyers?canceled=1`,
  });
  if (!res.ok) fail(res.error);
  redirect((res as { ok: true; url: string }).url);
}
