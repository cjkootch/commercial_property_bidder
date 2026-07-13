// Minimal Stripe integration over raw REST (no SDK dependency): one-time
// Checkout Sessions for lead unlocks + webhook signature verification.
// Follows the same shape as the Resend/Svix integration.

import crypto from "node:crypto";

export function getStripeKey(): string | null {
  const k = process.env.STRIPE_SECRET_KEY;
  return k && k.length > 0 ? k : null;
}
export function getStripeWebhookSecret(): string | null {
  const k = process.env.STRIPE_WEBHOOK_SECRET;
  return k && k.length > 0 ? k : null;
}
export function leadPriceCents(): number {
  const usd = Number(process.env.LEAD_PRICE_USD);
  return Number.isFinite(usd) && usd > 0 ? Math.round(usd * 100) : 7900;
}
/** Premium to close a lead outright (only offered while nobody else has it). */
export function exclusivePriceCents(): number {
  const usd = Number(process.env.LEAD_EXCLUSIVE_PRICE_USD);
  return Number.isFinite(usd) && usd > 0 ? Math.round(usd * 100) : 19900;
}
/** Price to print + mail one owner postcard (Lob cost + margin). */
export function postcardPriceCents(): number {
  const usd = Number(process.env.POSTCARD_PRICE_USD);
  return Number.isFinite(usd) && usd > 0 ? Math.round(usd * 100) : 900;
}

export type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

/** Checkout Session for a postcard mailing (metadata routes the webhook). */
export async function createPostcardCheckout(opts: {
  amountCents: number;
  leadName: string;
  buyerEmail: string;
  buyerId: string;
  unlockId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<CheckoutResult> {
  const key = getStripeKey();
  if (!key) return { ok: false, error: "Payments not configured (STRIPE_SECRET_KEY)." };
  const params = new URLSearchParams({
    mode: "payment",
    customer_email: opts.buyerEmail,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(opts.amountCents),
    "line_items[0][price_data][product_data][name]": `Owner postcard — ${opts.leadName}`.slice(0, 120),
    "metadata[type]": "postcard",
    "metadata[unlock_id]": opts.unlockId,
    "metadata[buyer_id]": opts.buyerId,
  });
  try {
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !data.url) return { ok: false, error: data.error?.message ?? `Stripe error (${res.status}).` };
    return { ok: true, url: data.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Stripe request failed." };
  }
}

/** Checkout Session for a self-serve prospect postcard (metadata routes the
 *  webhook to the prospect fulfillment path, not the lead-unlock path). */
export async function createProspectPostcardCheckout(opts: {
  amountCents: number;
  prospectLabel: string;
  buyerEmail: string;
  buyerId: string;
  prospectId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<CheckoutResult> {
  const key = getStripeKey();
  if (!key) return { ok: false, error: "Payments not configured (STRIPE_SECRET_KEY)." };
  const params = new URLSearchParams({
    mode: "payment",
    customer_email: opts.buyerEmail,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(opts.amountCents),
    "line_items[0][price_data][product_data][name]": `Prospect postcard — ${opts.prospectLabel}`.slice(0, 120),
    "metadata[type]": "prospect_postcard",
    "metadata[prospect_id]": opts.prospectId,
    "metadata[buyer_id]": opts.buyerId,
  });
  try {
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !data.url) return { ok: false, error: data.error?.message ?? `Stripe error (${res.status}).` };
    return { ok: true, url: data.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Stripe request failed." };
  }
}

/** Checkout Session for a residential lead package (metadata routes the
 *  webhook to the package delivery path). */
export async function createPackageCheckout(opts: {
  amountCents: number;
  packageName: string;
  buyerEmail: string;
  buyerId: string;
  packageId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<CheckoutResult> {
  const key = getStripeKey();
  if (!key) return { ok: false, error: "Payments not configured (STRIPE_SECRET_KEY)." };
  const params = new URLSearchParams({
    mode: "payment",
    customer_email: opts.buyerEmail,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(opts.amountCents),
    "line_items[0][price_data][product_data][name]": opts.packageName.slice(0, 120),
    "metadata[type]": "residential_package",
    "metadata[residential_package_id]": opts.packageId,
    "metadata[buyer_id]": opts.buyerId,
    // 3h expiry (Stripe default is 24h) so the checkout.session.expired
    // webhook can send the "still available" recovery nudge the same day.
    expires_at: String(Math.floor(Date.now() / 1000) + 3 * 3600),
  });
  try {
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !data.url) return { ok: false, error: data.error?.message ?? `Stripe error (${res.status}).` };
    return { ok: true, url: data.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Stripe request failed." };
  }
}

/** Create a one-time-payment Checkout Session for a lead unlock. */
export async function createLeadCheckout(opts: {
  amountCents: number;
  leadName: string;
  buyerEmail: string;
  buyerId: string;
  propertyId: string;
  /** "paid" (one shared spot) or "exclusive" (closes the lead) */
  kind: "paid" | "exclusive";
  /** Set = this is an EXCLUSIVE UPGRADE of an existing unlock (the webhook
   *  flips its kind instead of inserting a new row). */
  upgradeUnlockId?: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<CheckoutResult> {
  const key = getStripeKey();
  if (!key) return { ok: false, error: "Payments not configured (STRIPE_SECRET_KEY)." };

  const label = opts.upgradeUnlockId
    ? "Exclusive upgrade"
    : opts.kind === "exclusive"
      ? "Exclusive job sheet"
      : "Job sheet";
  const params = new URLSearchParams({
    mode: "payment",
    customer_email: opts.buyerEmail,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(opts.amountCents),
    "line_items[0][price_data][product_data][name]": `${label} — ${opts.leadName}`.slice(0, 120),
    "metadata[buyer_id]": opts.buyerId,
    "metadata[property_id]": opts.propertyId,
    "metadata[kind]": opts.kind,
    ...(opts.upgradeUnlockId
      ? { "metadata[type]": "exclusive_upgrade", "metadata[unlock_id]": opts.upgradeUnlockId }
      : {}),
    // 3h expiry (Stripe default is 24h) so the checkout.session.expired
    // webhook can send the "still available" recovery nudge the same day.
    expires_at: String(Math.floor(Date.now() / 1000) + 3 * 3600),
  });
  try {
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const data = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !data.url) {
      return { ok: false, error: data.error?.message ?? `Stripe error (${res.status}).` };
    }
    return { ok: true, url: data.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Stripe request failed." };
  }
}

/** Subscription Checkout Session for First Look (24h early access, monthly).
 *  metadata rides on BOTH the session and the subscription so renewal and
 *  cancellation events can find the buyer without a customer table. */
export async function createFirstLookCheckout(opts: {
  amountCents: number;
  buyerEmail: string;
  buyerId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<CheckoutResult> {
  const key = getStripeKey();
  if (!key) return { ok: false, error: "Payments not configured (STRIPE_SECRET_KEY)." };
  const params = new URLSearchParams({
    mode: "subscription",
    customer_email: opts.buyerEmail,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(opts.amountCents),
    "line_items[0][price_data][recurring][interval]": "month",
    "line_items[0][price_data][product_data][name]": "First Look — see every new job 24h early",
    "metadata[type]": "first_look",
    "metadata[buyer_id]": opts.buyerId,
    "subscription_data[metadata][type]": "first_look",
    "subscription_data[metadata][buyer_id]": opts.buyerId,
  });
  try {
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !data.url) return { ok: false, error: data.error?.message ?? `Stripe error (${res.status}).` };
    return { ok: true, url: data.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Stripe request failed." };
  }
}

/**
 * Refund a payment in full (lost cap race, duplicate purchase, unsellable
 * lead). Best-effort: returns false on any failure so callers flag the session
 * for a manual refund instead of crashing the webhook.
 */
export async function refundPayment(paymentIntentId: string | null | undefined): Promise<boolean> {
  const key = getStripeKey();
  if (!key || !paymentIntentId) return false;
  try {
    const res = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ payment_intent: paymentIntentId }).toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Verify a `Stripe-Signature` header (t=...,v1=...) against the raw payload.
 * Allows 5 minutes of clock skew.
 *
 * The header can carry MULTIPLE `v1=` signatures — Stripe signs with every
 * active endpoint secret during a webhook-secret rotation. We must accept the
 * event if ANY of them matches ours; taking only one (as `Object.fromEntries`
 * would) rejects valid paid events for the whole rotation window, which under
 * the no-refund policy means paid-but-unfulfilled customers.
 */
export function verifyStripeSignature(payload: string, header: string | null): boolean {
  const whsec = getStripeWebhookSecret();
  if (!whsec || !header) return false;
  let t: string | undefined;
  const v1s: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("="); // split once — hex sigs never contain '='
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key === "t") t = val;
    else if (key === "v1") v1s.push(val);
  }
  if (!t || v1s.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac("sha256", whsec).update(`${t}.${payload}`).digest("hex");
  const expectedBuf = Buffer.from(expected);
  return v1s.some((v1) => {
    // timingSafeEqual throws on length mismatch — guard before comparing.
    if (v1.length !== expected.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(v1), expectedBuf);
    } catch {
      return false;
    }
  });
}
