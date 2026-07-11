import { NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { prospectCompany, smsOptOut, smsSend } from "@/lib/db/schema";
import { smsStatusRank, verifyTwilioSignature } from "@/lib/integrations/twilio";
import { sendEmail } from "@/lib/integrations/resend";

// Twilio webhook, two shapes on one URL (both form-encoded POSTs):
//  - Status callbacks (MessageStatus present): update the sms_send row's
//    delivery state by twilio_sid.
//  - Inbound messages (no MessageStatus): honor STOP into sms_opt_out, log
//    the reply as an sms_send row (direction "in", matched to the company by
//    phone), and page the operator — an SMS reply is a hot conversion event.
// Configure the number's "A message comes in" webhook to POST here; outbound
// status callbacks are attached per-message by sendSms().
export const dynamic = "force-dynamic";

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout"]);
const START_WORDS = new Set(["start", "unstop", "yes"]);

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = typeof v === "string" ? v : "";

  // Reconstruct the exact public URL Twilio signed (proxies mangle req.url).
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const url = `${base}/api/webhooks/twilio`;
  if (!verifyTwilioSignature(url, params, req.headers.get("x-twilio-signature"))) {
    return new Response("invalid signature", { status: 403 });
  }

  // --- delivery status callback ---------------------------------------------
  if (params.MessageStatus && params.MessageSid) {
    const status = params.MessageStatus; // queued|sent|delivered|undelivered|failed
    // Callbacks arrive out of order — never downgrade (a late "sent" must not
    // overwrite "delivered"). Rank guard in the WHERE keeps it one atomic
    // statement (no transactions on the Neon HTTP driver).
    await db
      .update(smsSend)
      .set({
        status,
        error_code: params.ErrorCode || null,
        ...(status === "delivered" ? { delivered_at: new Date() } : {}),
      })
      .where(
        and(
          eq(smsSend.twilio_sid, params.MessageSid),
          sql`case ${smsSend.status}
                when 'delivered' then 3 when 'undelivered' then 3 when 'failed' then 3
                when 'sent' then 2
                when 'queued' then 1 when 'accepted' then 1 when 'sending' then 1
                else 0 end <= ${smsStatusRank(status)}`
        )
      );
    return new Response(null, { status: 204 });
  }

  // --- inbound message --------------------------------------------------------
  const from = params.From ?? "";
  const body = (params.Body ?? "").trim();
  if (!from || !body) return new Response(null, { status: 204 });

  // Twilio retries webhooks on slow/failed responses — dedupe by message SID
  // so a retry never double-logs the reply or double-pages the operator.
  const inboundSid = params.MessageSid || params.SmsMessageSid || null;
  if (inboundSid) {
    const [dup] = await db
      .select({ id: smsSend.id })
      .from(smsSend)
      .where(eq(smsSend.twilio_sid, inboundSid))
      .limit(1);
    if (dup) {
      return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
        headers: { "Content-Type": "text/xml" },
      });
    }
  }

  const word = body.toLowerCase().replace(/[^a-z]/g, "");
  if (STOP_WORDS.has(word)) {
    await db
      .insert(smsOptOut)
      .values({ phone: from, reason: `replied ${body.toUpperCase()}` })
      .onConflictDoNothing();
  } else if (START_WORDS.has(word)) {
    await db.delete(smsOptOut).where(eq(smsOptOut.phone, from));
  }

  // Match the sender to a company profile by phone (either format on file).
  const digits = from.replace(/\D/g, "").replace(/^1/, "");
  const companies = await db
    .select({ key: prospectCompany.key, name: prospectCompany.name, id: prospectCompany.id, phone: prospectCompany.phone })
    .from(prospectCompany);
  const match = companies.find((c) => (c.phone ?? "").replace(/\D/g, "").replace(/^1/, "") === digits);

  await db.insert(smsSend).values({
    direction: "in",
    kind: "inbound",
    company_key: match?.key ?? null,
    phone: from,
    body,
    twilio_sid: inboundSid,
    status: "received",
  });

  // Page the operator (skip bare STOP/START keywords — those are bookkeeping).
  const to = process.env.ALERT_EMAIL;
  if (to && !STOP_WORDS.has(word) && !START_WORDS.has(word)) {
    const link = match ? `${base}/companies/${match.id}` : `${base}/companies`;
    await sendEmail({
      to,
      subject: `💬 SMS reply from ${match?.name ?? from}`,
      html: `<p><strong>${match?.name ?? from}</strong> texted back:</p><blockquote style="border-left:3px solid #2f7d4f;margin:8px 0;padding:4px 12px;">${body
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")}</blockquote><p><a href="${link}">Open the company profile</a> to reply.</p>`,
      tags: { kind: "operator_alert" },
    }).catch(() => {});
  }

  // Empty TwiML so Twilio doesn't auto-reply or log an error.
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    headers: { "Content-Type": "text/xml" },
  });
}
