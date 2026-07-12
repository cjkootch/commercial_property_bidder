import { NextRequest } from "next/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyerOutreach, prospectCompany, smsOptOut, smsSend } from "@/lib/db/schema";
import { sendSms, smsStatusRank, verifyTwilioSignature } from "@/lib/integrations/twilio";
import { draftSmsReply } from "@/lib/integrations/claude";
import { currentOpportunityFor, inventoryContextFor } from "@/lib/sms/ai-context";
import { sendEmail } from "@/lib/integrations/resend";

// Twilio webhook, two shapes on one URL (both form-encoded POSTs):
//  - Status callbacks (MessageStatus present): update the sms_send row's
//    delivery state by twilio_sid.
//  - Inbound messages (no MessageStatus): honor STOP into sms_opt_out, log
//    the reply as an sms_send row (direction "in", matched to the company by
//    phone), AI-answer it (operator standing approval 2026-07-12), and page
//    the operator with what was said — both sides of it.
// Configure the number's "A message comes in" webhook to POST here; outbound
// status callbacks are attached per-message by sendSms().
export const dynamic = "force-dynamic";
export const maxDuration = 60; // the AI reply adds a model call

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout"]);
const START_WORDS = new Set(["start", "unstop", "yes"]);
/** After this many AI replies in one conversation, the machine goes quiet
 *  and the human takes over (the alert email flags it). */
const AI_REPLY_CAP = 4;

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
  const isStop = STOP_WORDS.has(word);
  // "YES"/"START" are opt-in keywords ONLY for a number that actually opted
  // out — a mid-conversation "Yes" is the conversion signal, not bookkeeping.
  const [optedOutRow] = await db
    .select({ id: smsOptOut.id })
    .from(smsOptOut)
    .where(eq(smsOptOut.phone, from))
    .limit(1);
  const isStart = START_WORDS.has(word) && !!optedOutRow;
  if (isStop) {
    await db
      .insert(smsOptOut)
      .values({ phone: from, reason: `replied ${body.toUpperCase()}` })
      .onConflictDoNothing();
  } else if (isStart) {
    await db.delete(smsOptOut).where(eq(smsOptOut.phone, from));
  }

  // Match the sender to a company profile by phone (either format on file).
  const digits = from.replace(/\D/g, "").replace(/^1/, "");
  const companies = await db
    .select({
      key: prospectCompany.key,
      name: prospectCompany.name,
      id: prospectCompany.id,
      phone: prospectCompany.phone,
      trade: prospectCompany.trade,
      office_city: prospectCompany.office_city,
      office_lat: prospectCompany.office_lat,
      office_lng: prospectCompany.office_lng,
    })
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

  // --- AI auto-reply (operator standing approval 2026-07-12) -----------------
  // Claude answers with the same rules as the draft button (deliver the claim
  // link on interest, never invent details, polite close on not-interested).
  // Goes quiet after AI_REPLY_CAP replies in a thread — the human takes over.
  // Kill switch: SMS_AI_AUTOREPLY=0. STOP/opt-in keywords are never answered,
  // and sendSms refuses opted-out numbers regardless.
  let aiReply: string | null = null;
  let aiCapped = false;
  if (!isStop && !isStart && process.env.SMS_AI_AUTOREPLY !== "0") {
    const thread = await db
      .select({ direction: smsSend.direction, body: smsSend.body, kind: smsSend.kind })
      .from(smsSend)
      .where(eq(smsSend.phone, from))
      .orderBy(asc(smsSend.created_at));
    const aiCount = thread.filter((m) => m.kind === "ai_reply").length;
    aiCapped = aiCount >= AI_REPLY_CAP;
    if (!aiCapped) {
      let claimUrl: string | null = null;
      let offeredPropertyId: string | null = null;
      let inventory: string | null = null;
      let currentOpportunity: string | null = null;
      if (match) {
        const offers = await db
          .select({ claim_url: buyerOutreach.claim_url, property_id: buyerOutreach.property_id })
          .from(buyerOutreach)
          .where(eq(buyerOutreach.company_key, match.key))
          .orderBy(desc(buyerOutreach.sent_at))
          .limit(10);
        const withClaim = offers.find((o) => o.claim_url);
        claimUrl = withClaim?.claim_url ?? null;
        offeredPropertyId = withClaim?.property_id ?? null;
        [currentOpportunity, inventory] = await Promise.all([
          currentOpportunityFor(match.key),
          inventoryContextFor({
            companyName: match.name,
            trade: match.trade,
            lat: match.office_lat,
            lng: match.office_lng,
            excludePropertyId: offeredPropertyId,
          }),
        ]);
      }
      const draft = await draftSmsReply({
        companyName: match?.name ?? null,
        city: match?.office_city ?? null,
        trade: match?.trade ?? null,
        claimUrl,
        currentOpportunity,
        inventory,
        thread,
      });
      if (draft) {
        const res = await sendSms({
          to: from,
          body: draft,
          kind: "ai_reply",
          companyKey: match?.key ?? null,
          refId: match?.id ?? null,
        });
        if (res.ok) aiReply = draft;
      }
    }
  }

  // Page the operator with both sides (skip pure opt-out bookkeeping).
  const to = process.env.ALERT_EMAIL;
  if (to && !isStop && !isStart) {
    const link = match ? `${base}/companies/${match.id}` : `${base}/messages/sms`;
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    await sendEmail({
      to,
      subject: `💬 SMS reply from ${match?.name ?? from}`,
      html:
        `<p><strong>${esc(match?.name ?? from)}</strong> texted:</p>` +
        `<blockquote style="border-left:3px solid #2f7d4f;margin:8px 0;padding:4px 12px;">${esc(body)}</blockquote>` +
        (aiReply
          ? `<p>🤖 AI answered:</p><blockquote style="border-left:3px solid #2563eb;margin:8px 0;padding:4px 12px;">${esc(aiReply)}</blockquote>`
          : aiCapped
            ? `<p>⚠️ AI reply cap reached for this thread — <strong>your turn</strong>.</p>`
            : `<p>No AI reply was sent — reply yourself.</p>`) +
        `<p><a href="${link}">Open the thread</a> to take over any time.</p>`,
      tags: { kind: "operator_alert" },
    }).catch(() => {});
  }

  // Empty TwiML so Twilio doesn't auto-reply or log an error.
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    headers: { "Content-Type": "text/xml" },
  });
}
