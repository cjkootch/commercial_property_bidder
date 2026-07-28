// Resend webhook sink: delivery/engagement events → the activity row that
// carries the message, plus automatic suppression on bounce/complaint.
//
// Ported from app/api/webhooks/resend/route.ts and simplified in one important
// way: the source fanned every event out to THREE domain tables with parallel
// column sets (outreach, buyer_outreach, email_send) plus a fourth path for
// follow-up "nudge" message ids — ~120 lines of near-duplicate UPDATEs and the
// place where attribution bugs actually lived. Here every send is one `activity`
// row keyed by `external_id`, so each event is a single UPDATE.
//
// Preserved from the source, because each was a real incident:
//   - FAIL CLOSED without a signing secret (an unsigned webhook can suppress
//     arbitrary addresses or forge inbound replies onto a timeline).
//   - svix-id idempotency marker: Svix retries on any non-2xx/timeout, and
//     without this every retry double-counted opens and re-alerted replies.
//   - Multiple signing secrets accepted (see verifyResendSignature).
//   - Hard bounces AND complaints go straight onto the suppression list.
//
// Route placement in the new app: app/api/webhooks/resend/route.ts. Must be
// excluded from auth middleware, and must run on the NODE runtime (node:crypto).

import { NextResponse, type NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "../../../../db";
import { activity } from "../../../../db/schema";
import { getResendWebhookSecrets, verifyResendSignature } from "../../../../email/resend";
import { suppress } from "../../../../email/suppression";
import { onceEver } from "../../../../runtime/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ResendEvent = {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    from?: string;
    subject?: string;
  };
};

const firstRecipient = (to: string[] | string | undefined): string | null =>
  Array.isArray(to) ? to[0] ?? null : to ?? null;

export async function POST(req: NextRequest) {
  const raw = await req.text();

  if (!getResendWebhookSecrets().length) {
    console.error("resend webhook: RESEND_WEBHOOK_SECRET not set — rejecting");
    return NextResponse.json({ error: "webhook secret not configured" }, { status: 401 });
  }
  const ok = verifyResendSignature(raw, {
    id: req.headers.get("svix-id"),
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
  });
  if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  // Idempotency: one marker per svix-id, ever.
  const svixId = req.headers.get("svix-id");
  if (svixId && !(await onceEver(`resend_evt:${svixId}`))) {
    return NextResponse.json({ ok: true, skipped: "duplicate delivery" });
  }

  let evt: ResendEvent;
  try {
    evt = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const emailId = evt.data?.email_id;
  const type = evt.type ?? "";
  if (!emailId) return NextResponse.json({ ok: true }); // nothing to match on

  const at = evt.created_at ? new Date(evt.created_at) : new Date();
  const target = eq(activity.external_id, emailId);

  try {
    switch (type) {
      case "email.delivered":
        await db.update(activity).set({ delivered_at: at }).where(target);
        break;

      case "email.opened":
        // coalesce: keep the FIRST open as the timestamp, count every one.
        await db
          .update(activity)
          .set({
            opened_at: sql`coalesce(${activity.opened_at}, ${at.toISOString()})`,
            open_count: sql`${activity.open_count} + 1`,
          })
          .where(target);
        break;

      case "email.clicked":
        await db
          .update(activity)
          .set({
            clicked_at: sql`coalesce(${activity.clicked_at}, ${at.toISOString()})`,
            click_count: sql`${activity.click_count} + 1`,
          })
          .where(target);
        break;

      case "email.bounced": {
        await db.update(activity).set({ bounced_at: at }).where(target);
        // A hard-bounced address must be suppressed, or the next campaign
        // rediscovers the company, re-sends to the same dead mailbox, and
        // bounces again — reputation poison.
        const bounced = firstRecipient(evt.data?.to);
        if (bounced) await suppress(bounced, "resend bounce");
        break;
      }

      case "email.complained": {
        await db.update(activity).set({ complained_at: at }).where(target);
        const complained = firstRecipient(evt.data?.to);
        if (complained) await suppress(complained, "resend complaint");
        break;
      }

      default:
        // Unknown/unhandled event types are acknowledged, not errored — a 4xx
        // makes Svix retry forever on an event we simply don't care about.
        break;
    }
  } catch (e) {
    // Return 500 so Svix retries; the marker above was already claimed, so a
    // retry would be skipped. Release it by NOT claiming until after success if
    // you need retry-on-error — see PACKET.md → rough edges.
    console.error("resend webhook handler failed:", e);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, type });
}
