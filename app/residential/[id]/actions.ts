"use server";

// Guest checkout from the PUBLIC package preview (2026-07-22 "we're asking
// too much"): look → card. No account first — Stripe collects the email and
// the webhook creates the buyer + delivers the report with a sign-in link.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { residentialPackage } from "@/lib/db/schema";
import { createGuestPackageCheckout } from "@/lib/integrations/stripe";
import { packageSpotsLeft, resiMaxBuyers } from "@/lib/residential/availability";
import { asTrade } from "@/lib/leads/trades";
import { rateLimit, clientIp } from "@/lib/ratelimit";

function baseUrl(): string {
  const envBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (envBase && !/localhost|127\.0\.0\.1/.test(envBase)) return envBase;
  const host = headers().get("host");
  return host ? `https://${host}` : "https://greenkeep.us";
}

export async function startGuestPackageCheckout(packageId: string, formData: FormData): Promise<void> {
  const fail = (msg: string): never =>
    redirect(`/residential/${packageId}?err=${encodeURIComponent(msg)}`);

  // Public endpoint — IP-limited. Each attempt only creates a Stripe session
  // (no inventory consumed until payment), so a modest cap suffices.
  const rl = await rateLimit(`guestcheckout:ip:${clientIp()}`, 10, 3600);
  if (!rl.ok) fail("Too many attempts — try again in a bit.");

  const trade = asTrade(String(formData.get("trade") ?? "landscaping"));
  const [pkg] = await db
    .select()
    .from(residentialPackage)
    .where(eq(residentialPackage.id, packageId))
    .limit(1);
  if (!pkg || pkg.status !== "published") fail("This report isn't available right now.");
  if ((await packageSpotsLeft(packageId, trade)) <= 0) {
    fail(
      `Sold out for your trade — we cap every list at ${resiMaxBuyers()} companies per trade.`
    );
  }

  const base = baseUrl();
  const res = await createGuestPackageCheckout({
    amountCents: pkg!.price_cents,
    packageName: pkg!.name,
    packageId: pkg!.id,
    trade,
    successUrl: `${base}/residential/${packageId}?purchased=1`,
    cancelUrl: `${base}/residential/${packageId}?canceled=1`,
  });
  if (!res.ok) fail(res.error);
  redirect((res as { ok: true; url: string }).url);
}
