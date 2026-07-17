"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, residentialPackage, residentialUnlock } from "@/lib/db/schema";
import { currentBuyerId } from "@/app/buyers/actions";
import { createPackageCheckout } from "@/lib/integrations/stripe";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { packageSpotsLeft, resiMaxBuyers } from "@/lib/residential/availability";
import { asTrade } from "@/lib/leads/trades";
import { transactionsBlocked } from "@/lib/suppression";

function baseUrl(): string {
  const envBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (envBase && !/localhost|127\.0\.0\.1/.test(envBase)) return envBase;
  const host = headers().get("host");
  return host ? `https://${host}` : "https://greenkeep.us";
}

/**
 * Stripe checkout for a residential package: pay -> webhook snapshots the
 * address dossier onto the unlock and emails the report link. Errors land as
 * a marketplace banner.
 */
export async function startResidentialPackageCheckout(packageId: string): Promise<void> {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const [row] = await db.select().from(buyer).where(eq(buyer.id, buyerId!)).limit(1);
  if (!row) redirect("/buyers/login");

  const fail = (msg: string): never =>
    redirect(`/buyers/residential?err=${encodeURIComponent(msg)}`);

  const rl = await rateLimit(`buyercheckout:ip:${clientIp()}`, 20, 3600);
  if (!rl.ok) fail("Too many attempts — try again in a bit.");

  // Bounce/complaint suppression blocks purchases; a mere marketing
  // unsubscribe must NOT (lib/suppression) — cold prospects who opted out of
  // email and later chose to convert were being turned away at checkout.
  if (await transactionsBlocked(row!.email)) fail("This account can't make purchases — contact us.");

  const [pkg] = await db
    .select()
    .from(residentialPackage)
    .where(eq(residentialPackage.id, packageId))
    .limit(1);
  if (!pkg || pkg.status !== "published") fail("This report isn't available right now.");

  const [mine] = await db
    .select()
    .from(residentialUnlock)
    .where(
      and(
        eq(residentialUnlock.residential_package_id, packageId),
        eq(residentialUnlock.buyer_id, row!.id)
      )
    )
    .limit(1);
  if (mine) redirect(`/buyers/residential/${packageId}`);

  // Per-trade cap (never-oversell, same as commercial): the pitch promises at
  // most N companies per trade get each list — enforce it before Stripe. The
  // webhook re-checks at delivery, so a race here degrades to account credit.
  const spots = await packageSpotsLeft(packageId, asTrade(row!.trade));
  if (spots <= 0) {
    fail(
      `This list has sold out for your trade — we cap every list at ${resiMaxBuyers()} companies per trade. Similar lists are below.`
    );
  }

  const base = baseUrl();
  const res = await createPackageCheckout({
    amountCents: pkg!.price_cents,
    packageName: pkg!.name,
    buyerEmail: row!.email,
    buyerId: row!.id,
    packageId: pkg!.id,
    successUrl: `${base}/buyers/residential?purchased=1`,
    cancelUrl: `${base}/buyers/residential?canceled=1`,
  });
  if (!res.ok) fail(res.error);
  redirect((res as { ok: true; url: string }).url);
}
