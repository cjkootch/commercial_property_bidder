import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, leadUnlock, suppression } from "@/lib/db/schema";
import { verifyBuyerUnsub } from "@/lib/buyer-auth";

// One-click unsubscribe (linked from alert emails + List-Unsubscribe header).
// No login required: the HMAC token proves the email. Scoped to alert emails
// (buyer.notify) — NOT the global suppression list, which is for bounces and
// complaints and would also block purchases and receipts. Middleware
// whitelists /api/unsubscribe.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const email = verifyBuyerUnsub(req.nextUrl.searchParams.get("token"));
  if (!email) {
    return new NextResponse("This unsubscribe link is invalid.", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
  }
  const updated = await db
    .update(buyer)
    .set({ notify: false, updated_at: new Date() })
    .where(eq(buyer.email, email))
    .returning({ id: buyer.id });
  // The suppression list is what the campaign/alert/nudge engines actually
  // check — a buyer row alone doesn't stop them (account exclusion keys on
  // company NAME, which incidental rows from the chat widget or a re-spelled
  // signup don't match). So: suppress every unsubscriber EXCEPT a real
  // customer (has unlocks) — suppression also blocks purchases, and a paying
  // customer opting out of alerts must not lose the ability to buy. Their
  // marketing stops via notify=false + account exclusion. (CAN-SPAM: every
  // non-customer gets a durable opt-out.)
  const isCustomer =
    updated.length > 0 &&
    (
      await db
        .select({ id: leadUnlock.id })
        .from(leadUnlock)
        .where(eq(leadUnlock.buyer_id, updated[0].id))
        .limit(1)
    ).length > 0;
  if (!isCustomer) {
    await db
      .insert(suppression)
      .values({ email: email.toLowerCase(), reason: "one-click unsubscribe" })
      .onConflictDoNothing({ target: suppression.email });
  }

  return new NextResponse(
    `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;background:#f9fafb">
<div style="max-width:420px;padding:32px;background:#fff;border:1px solid #e5e7eb;border-radius:16px;text-align:center">
<h1 style="font-size:18px;margin:0 0 8px">You're unsubscribed</h1>
<p style="color:#6b7280;font-size:14px;margin:0">${email} will no longer receive job alerts. Changed your mind? Sign in to your dashboard and turn alerts back on.</p>
</div></body>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

// RFC 8058 one-click unsubscribe: mail clients POST to the List-Unsubscribe
// URL with no body — treat it exactly like the GET.
export async function POST(req: NextRequest) {
  return GET(req);
}
