import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, leadUnlock, property } from "@/lib/db/schema";
import { verifyStripeSignature } from "@/lib/integrations/stripe";
import { buildDossier } from "@/lib/leads/dossier";
import { sendEmail } from "@/lib/integrations/resend";
import { getDefaultCompany } from "@/lib/db/queries";

// Stripe webhook: on checkout.session.completed, unlock the lead for the
// paying buyer — build the dossier snapshot, stamp sold-once, and email them.
// Idempotent (duplicate deliveries are no-ops); signature is verified against
// the RAW body. Middleware exempts /api/webhooks from auth.
export const dynamic = "force-dynamic";

type CheckoutSession = {
  id: string;
  amount_total: number | null;
  metadata?: { buyer_id?: string; property_id?: string };
};

function appUrl(): string {
  const envBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return envBase && !/localhost|127\.0\.0\.1/.test(envBase) ? envBase : "https://greenkeep.us";
}

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
  if (!session || !buyerId || !propertyId) {
    return NextResponse.json({ received: true, skipped: "no lead metadata" });
  }

  const [b] = await db.select().from(buyer).where(eq(buyer.id, buyerId)).limit(1);
  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!b || !prop) return NextResponse.json({ received: true, skipped: "unknown buyer/property" });

  // Idempotency + sold-once: property_id is UNIQUE on lead_unlock. If the row
  // already exists (duplicate delivery, or a race the buyer lost), do nothing —
  // a lost race is refunded manually from the Stripe dashboard.
  const [existing] = await db.select().from(leadUnlock).where(eq(leadUnlock.property_id, propertyId)).limit(1);
  if (existing) {
    return NextResponse.json({ received: true, skipped: "already unlocked" });
  }

  const co = await getDefaultCompany();
  const dossier = co ? await buildDossier(prop, co.name).catch(() => null) : null;

  const [unlock] = await db
    .insert(leadUnlock)
    .values({
      buyer_id: b.id,
      property_id: prop.id,
      kind: "paid",
      price_cents: session.amount_total ?? 0,
      stripe_session_id: session.id,
      dossier,
    })
    .onConflictDoNothing({ target: leadUnlock.property_id })
    .returning();
  if (!unlock) return NextResponse.json({ received: true, skipped: "lost insert race" });

  await db
    .update(property)
    .set({ lead_exported_at: new Date(), lead_buyer: b.company_name, updated_at: new Date() })
    .where(and(eq(property.id, prop.id), isNull(property.lead_exported_at)));

  const link = `${appUrl()}/buyers/leads/${unlock.id}`;
  await sendEmail({
    to: b.email,
    subject: `Your job sheet is ready — ${prop.name.replace(/ \(TABS [^)]+\)$/, "")}`,
    html: `<p>Payment received — the full sheet is unlocked and exclusive to ${b.company_name}.</p><p><a href="${link}">Open your job sheet</a></p><p style="color:#888;font-size:12px">Location, decision contacts, aerial measurement, contract value, and the window to bid — all on one page.</p>`,
    tags: { kind: "lead_unlock" },
  }).catch(() => null);

  return NextResponse.json({ received: true, unlocked: unlock.id });
}
