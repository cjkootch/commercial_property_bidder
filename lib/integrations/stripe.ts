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

/** Create a one-time-payment Checkout Session for a lead unlock. */
export async function createLeadCheckout(opts: {
  amountCents: number;
  leadName: string;
  buyerEmail: string;
  buyerId: string;
  propertyId: string;
  /** "paid" (one shared spot) or "exclusive" (closes the lead) */
  kind: "paid" | "exclusive";
  successUrl: string;
  cancelUrl: string;
}): Promise<CheckoutResult> {
  const key = getStripeKey();
  if (!key) return { ok: false, error: "Payments not configured (STRIPE_SECRET_KEY)." };

  const label = opts.kind === "exclusive" ? "Exclusive job sheet" : "Job sheet";
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
 */
export function verifyStripeSignature(payload: string, header: string | null): boolean {
  const whsec = getStripeWebhookSecret();
  if (!whsec || !header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => kv.split("=") as [string, string])
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac("sha256", whsec).update(`${t}.${payload}`).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
  } catch {
    return false;
  }
}
