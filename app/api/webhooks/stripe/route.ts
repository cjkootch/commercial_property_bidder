import { NextResponse, type NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, leadUnlock, property, usageCounter } from "@/lib/db/schema";
import { refundPayment, verifyStripeSignature } from "@/lib/integrations/stripe";
import { buildDossier } from "@/lib/leads/dossier";
import { asTrade } from "@/lib/leads/trades";
import {
  closeLeadIfDone,
  confirmUnlockWithinCap,
  leadAvailability,
} from "@/lib/leads/availability";
import { sendEmail } from "@/lib/integrations/resend";
import { getDefaultCompany } from "@/lib/db/queries";

// Stripe webhook: on checkout.session.completed, unlock the lead for the
// paying buyer — build the dossier snapshot, close the lead if the cap filled
// or an exclusive sold, and email the sheet link.
//
// NO-REFUNDS POLICY (disclosed at checkout): if the lead can't be delivered
// (sold out between checkout and payment, duplicate purchase), the payment
// becomes ACCOUNT CREDIT that auto-applies to the buyer's next unlock. The
// only automatic refund is a payment we can't match to any buyer — there is
// nobody to credit. Idempotent (duplicate deliveries are no-ops); signature is
// verified against the RAW body. Middleware exempts /api/webhooks from auth.
export const dynamic = "force-dynamic";
// Dossier build touches TABS + Mapbox + county services; don't die at the
// platform default. Stripe retries on timeout and the flow is idempotent.
export const maxDuration = 60;

type CheckoutSession = {
  id: string;
  amount_total: number | null;
  payment_status?: string;
  payment_intent?: string | null;
  metadata?: {
    buyer_id?: string;
    property_id?: string;
    kind?: string;
    type?: string;
    unlock_id?: string;
    prospect_id?: string;
  };
};

function appUrl(): string {
  const envBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return envBase && !/localhost|127\.0\.0\.1/.test(envBase) ? envBase : "https://greenkeep.us";
}

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;

export async function POST(req: NextRequest) {
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"))) {
    return new NextResponse("Invalid signature", { status: 400 });
  }

  let event: { type?: string; data?: { object?: CheckoutSession } };
  try {
    event = JSON.parse(payload);
  } catch {
    return new NextResponse("Bad payload", { status: 400 });
  }
  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true });
  }

  const session = event.data?.object;
  const buyerId = session?.metadata?.buyer_id;
  const propertyId = session?.metadata?.property_id;
  const kind = session?.metadata?.kind === "exclusive" ? "exclusive" : "paid";
  if (!session || !buyerId) {
    return NextResponse.json({ received: true, skipped: "no metadata" });
  }
  // Async payment methods complete the session before funds settle — only
  // fulfill on settled money (card sessions are always "paid" here).
  if (session.payment_status && session.payment_status !== "paid") {
    return NextResponse.json({ received: true, skipped: `payment_status ${session.payment_status}` });
  }

  // Postcard purchase (not a lead unlock) — fulfill via Lob.
  if (session.metadata?.type === "postcard") {
    const unlockId = session.metadata?.unlock_id;
    if (!unlockId) return NextResponse.json({ received: true, skipped: "no unlock for postcard" });
    const [b] = await db.select().from(buyer).where(eq(buyer.id, buyerId)).limit(1);
    const { fulfillPostcard } = await import("@/lib/leads/postcard");
    const r = await fulfillPostcard({
      unlockId,
      buyerId,
      priceCents: session.amount_total ?? 0,
      stripeSessionId: session.id,
    });
    if (!r.ok) {
      // Paid but couldn't mail — credit the buyer (no-refund policy) + notify.
      if (b) await creditAndNotify(session, b, `we couldn't mail that postcard (${r.error})`);
      else console.error(`[stripe] postcard failed, no buyer to credit — ${session.id}: ${r.error}`);
      return NextResponse.json({ received: true, postcard: "failed", error: r.error });
    }
    if (b) {
      await sendEmail({
        to: b.email,
        subject: "Your postcard is on its way",
        html: `<p>${b.company_name} — your postcard to the property owner has been sent to print${r.expectedDelivery ? ` and should arrive around <strong>${r.expectedDelivery}</strong>` : ""}.</p><p><a href="${appUrl()}/buyers/leads/${unlockId}">View the lead</a></p>`,
        tags: { kind: "postcard" },
      }).catch(() => null);
    }
    return NextResponse.json({ received: true, postcard: r.postcardId });
  }

  // Self-serve prospect postcard (buyer-chosen address) — fulfill via Lob.
  if (session.metadata?.type === "prospect_postcard") {
    const prospectId = session.metadata?.prospect_id;
    if (!prospectId) return NextResponse.json({ received: true, skipped: "no prospect for postcard" });
    const [b] = await db.select().from(buyer).where(eq(buyer.id, buyerId)).limit(1);
    const { fulfillProspectPostcard } = await import("@/lib/prospects/postcard");
    const r = await fulfillProspectPostcard({
      prospectId,
      buyerId,
      priceCents: session.amount_total ?? 0,
      stripeSessionId: session.id,
    });
    if (!r.ok) {
      if (b) await creditAndNotify(session, b, `we couldn't mail that postcard (${r.error})`);
      else console.error(`[stripe] prospect postcard failed, no buyer to credit — ${session.id}: ${r.error}`);
      return NextResponse.json({ received: true, prospect_postcard: "failed", error: r.error });
    }
    if (b) {
      await sendEmail({
        to: b.email,
        subject: "Your postcard is on its way",
        html: `<p>${b.company_name} — your postcard has been sent to print${r.expectedDelivery ? ` and should arrive around <strong>${r.expectedDelivery}</strong>` : ""}.</p><p><a href="${appUrl()}/buyers/prospects/${prospectId}">View the prospect</a></p>`,
        tags: { kind: "postcard" },
      }).catch(() => null);
    }
    return NextResponse.json({ received: true, prospect_postcard: r.postcardId });
  }

  if (!propertyId) return NextResponse.json({ received: true, skipped: "no property" });

  // Idempotency: this exact session already produced an unlock.
  const [done] = await db.select().from(leadUnlock).where(eq(leadUnlock.stripe_session_id, session.id)).limit(1);
  if (done) return NextResponse.json({ received: true, skipped: "duplicate delivery" });

  const [b] = await db.select().from(buyer).where(eq(buyer.id, buyerId)).limit(1);
  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!b) {
    // Nobody to credit — the one case that still auto-refunds.
    const refunded = await refundPayment(session.payment_intent);
    if (!refunded) console.error(`[stripe] UNMATCHED PAYMENT, refund failed — session ${session.id}: refund manually.`);
    return NextResponse.json({ received: true, refunded, reason: "unknown buyer" });
  }
  if (!prop) return creditAndNotify(session, b, "the job you paid for is no longer listed");

  // Sold out (or exported) between checkout and payment? Credit, don't ghost.
  // Availability is per trade — the buyer's trade decides which spots count.
  const avail = await leadAvailability(prop, asTrade(b.trade));
  const lost =
    avail.closed || (kind === "exclusive" && !avail.exclusiveOpen)
      ? kind === "exclusive"
        ? "another company got there first, so the exclusive was no longer available"
        : "the last spot on this job went to another company moments before your payment"
      : null;
  if (lost) return creditAndNotify(session, b, lost);

  const co = await getDefaultCompany();
  const buyerLoc: [number, number] | null = b.lng != null && b.lat != null ? [b.lng, b.lat] : null;
  const dossier = co ? await buildDossier(prop, co.name, buyerLoc).catch(() => null) : null;

  const [unlock] = await db
    .insert(leadUnlock)
    .values({
      buyer_id: b.id,
      property_id: prop.id,
      kind,
      trade: asTrade(b.trade),
      price_cents: session.amount_total ?? 0,
      stripe_session_id: session.id,
      dossier,
    })
    .onConflictDoNothing({ target: [leadUnlock.property_id, leadUnlock.buyer_id] })
    .returning();
  if (!unlock) {
    // Buyer already holds this lead (double-pay) — the duplicate becomes credit.
    return creditAndNotify(session, b, "you already had this lead, so we converted the duplicate charge");
  }

  // No-transaction race guard: if this row landed over the cap (or clashed
  // with an exclusive), it's rolled back and the money becomes credit.
  if (!(await confirmUnlockWithinCap(unlock.id, prop.id))) {
    return creditAndNotify(session, b, "the last spot on this job went to another company moments before your payment");
  }
  await closeLeadIfDone(prop.id);

  const link = `${appUrl()}/buyers/leads/${unlock.id}`;
  const facility = prop.name.replace(/ \((TABS|HCAD|STP|H311|TABC|TAX|RFP) [^)]+\)$/, "");
  await sendEmail({
    to: b.email,
    subject: `Your job sheet is ready — ${facility}`,
    html:
      `<p>Payment received — the full sheet is unlocked for ${b.company_name}${kind === "exclusive" ? " <strong>exclusively</strong> — closed to every other company in your trade, permanently" : ""}.</p>` +
      `<p><a href="${link}">Open your job sheet</a></p>` +
      `<p style="color:#888;font-size:12px">Location, decision contacts, aerial measurement, contract value, and the window to bid — all on one page.</p>`,
    tags: { kind: "lead_unlock" },
  }).catch(() => null);

  return NextResponse.json({ received: true, unlocked: unlock.id });
}

// Far-future sentinel window so the counter pruner (which drops PAST windows)
// never erases these one-shot idempotency markers.
const CREDIT_MARKER_WINDOW = new Date("2099-01-01T00:00:00Z");

/**
 * Undeliverable purchase -> account credit (replacement-lead policy, disclosed
 * at checkout), exactly once per Stripe session even across webhook retries.
 */
async function creditAndNotify(
  session: CheckoutSession,
  b: { id: string; email: string; company_name: string },
  reason: string
) {
  const amount = session.amount_total ?? 0;
  if (amount > 0) {
    const marker = await db
      .insert(usageCounter)
      .values({ key: `stripe_credit:${session.id}`, window_start: CREDIT_MARKER_WINDOW, count: 1 })
      .onConflictDoNothing({ target: [usageCounter.key, usageCounter.window_start] })
      .returning();
    if (marker.length === 0) {
      return NextResponse.json({ received: true, skipped: "credit already granted" });
    }
    await db
      .update(buyer)
      .set({ credit_cents: sql`${buyer.credit_cents} + ${amount}`, updated_at: new Date() })
      .where(eq(buyer.id, b.id));
  }
  await sendEmail({
    to: b.email,
    subject: `That job sold out — your ${usd(amount)} credit is ready`,
    html:
      `<p>${b.company_name} — ${reason}. Your payment is now a <strong>${usd(amount)} credit</strong> on your account.</p>` +
      `<p>It applies automatically: it auto-applies to any open job at or below that amount in <a href="${appUrl()}/buyers">your dashboard</a> — no card needed — and it never expires.</p>` +
      `<p style="color:#888;font-size:12px">We cap every job at a fixed number of companies and never oversell — that's why spots can go fast.</p>`,
    tags: { kind: "lead_credit" },
  }).catch(() => null);
  return NextResponse.json({ received: true, credited: amount, reason });
}
