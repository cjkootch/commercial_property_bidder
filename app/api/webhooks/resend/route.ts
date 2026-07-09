import { NextResponse, type NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyerOutreach, outreach, suppression } from "@/lib/db/schema";
import { getResendKey, verifyResendSignature } from "@/lib/integrations/resend";
import { alertOperatorOfReply, emailAddressOf } from "@/lib/email/reply-alert";

// Resend webhook sink: records email delivery/open/click/bounce/complaint events
// against the matching outreach row (by Resend message id), powering email open
// rates. Covers both owner outreach and buyer-prospecting campaign sends — one
// event fans out to both tables; the message id only ever matches one row.
// Public (whitelisted in middleware) but signature-verified.
export const dynamic = "force-dynamic";

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

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const ok = verifyResendSignature(raw, {
    id: req.headers.get("svix-id"),
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
  });
  if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  let evt: ResendEvent;
  try {
    evt = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const emailId = evt.data?.email_id;
  const type = evt.type ?? "";
  if (!emailId) return NextResponse.json({ ok: true }); // nothing to match

  const at = evt.created_at ? new Date(evt.created_at) : new Date();

  try {
    switch (type) {
      case "email.delivered":
        await db
          .update(outreach)
          .set({ delivered_at: at, last_event: type, updated_at: new Date() })
          .where(eq(outreach.resend_message_id, emailId));
        await db
          .update(buyerOutreach)
          .set({ delivered_at: at, last_event: type, updated_at: new Date() })
          .where(eq(buyerOutreach.resend_message_id, emailId));
        break;
      case "email.opened":
        await db
          .update(outreach)
          .set({
            opened_at: sql`coalesce(${outreach.opened_at}, ${at.toISOString()})`,
            open_count: sql`${outreach.open_count} + 1`,
            last_event: type,
            updated_at: new Date(),
          })
          .where(eq(outreach.resend_message_id, emailId));
        await db
          .update(buyerOutreach)
          .set({
            opened_at: sql`coalesce(${buyerOutreach.opened_at}, ${at.toISOString()})`,
            open_count: sql`${buyerOutreach.open_count} + 1`,
            last_event: type,
            updated_at: new Date(),
          })
          .where(eq(buyerOutreach.resend_message_id, emailId));
        break;
      case "email.clicked":
        await db
          .update(outreach)
          .set({
            clicked_at: sql`coalesce(${outreach.clicked_at}, ${at.toISOString()})`,
            click_count: sql`${outreach.click_count} + 1`,
            last_event: type,
            updated_at: new Date(),
          })
          .where(eq(outreach.resend_message_id, emailId));
        await db
          .update(buyerOutreach)
          .set({
            clicked_at: sql`coalesce(${buyerOutreach.clicked_at}, ${at.toISOString()})`,
            click_count: sql`${buyerOutreach.click_count} + 1`,
            last_event: type,
            updated_at: new Date(),
          })
          .where(eq(buyerOutreach.resend_message_id, emailId));
        break;
      case "email.bounced":
        await db
          .update(outreach)
          .set({ status: "bounced", last_event: type, updated_at: new Date() })
          .where(eq(outreach.resend_message_id, emailId));
        await db
          .update(buyerOutreach)
          .set({ status: "bounced", last_event: type, updated_at: new Date() })
          .where(eq(buyerOutreach.resend_message_id, emailId));
        break;
      case "email.complained": {
        await db
          .update(outreach)
          .set({ status: "unsubscribed", last_event: type, updated_at: new Date() })
          .where(eq(outreach.resend_message_id, emailId));
        await db
          .update(buyerOutreach)
          .set({ last_event: type, updated_at: new Date() })
          .where(eq(buyerOutreach.resend_message_id, emailId));
        // Suppress the complainer so we never email them again.
        const to = Array.isArray(evt.data?.to) ? evt.data?.to[0] : evt.data?.to;
        if (to) {
          await db
            .insert(suppression)
            .values({ email: to, reason: "resend complaint" })
            .onConflictDoNothing();
        }
        break;
      }
      case "email.received": {
        // An inbound reply to leads@ (Resend receiving handles the domain's
        // MX). The event carries metadata only — fetch the parsed body, then
        // alert the operator with a company-profile match.
        const key = getResendKey();
        let text = "";
        let from = evt.data?.from ?? null;
        let subject = evt.data?.subject ?? null;
        if (key) {
          const r = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
            headers: { Authorization: `Bearer ${key}` },
          });
          if (r.ok) {
            const d = (await r.json()) as { from?: string; subject?: string; text?: string | null; html?: string | null };
            from = d.from ?? from;
            subject = d.subject ?? subject;
            text = d.text ?? d.html?.replace(/<[^>]+>/g, " ") ?? "";
          } else {
            console.error(`email.received: content fetch failed (${r.status})`);
          }
        }
        await alertOperatorOfReply({ from, fromEmail: emailAddressOf(from), subject, text });
        break;
      }
      default:
        break;
    }
  } catch {
    // Best-effort: never error back to Resend (it would retry storms).
  }

  return NextResponse.json({ ok: true });
}
