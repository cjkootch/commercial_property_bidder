import { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyerOutreach, prospectCompany, smsOptOut, smsSend } from "@/lib/db/schema";
import { sendSms, smsStatusRank, verifyTwilioSignature } from "@/lib/integrations/twilio";
import { draftSmsReply } from "@/lib/integrations/claude";
import { inventoryContextFor } from "@/lib/sms/ai-context";
import { freshClaimUrl, withinTcpaHours } from "@/lib/sms/queue";
import { marketTz } from "@/lib/markets";
import type { SmsIntent } from "@/lib/integrations/claude";
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
export const maxDuration = 300; // the deferred AI reply sleeps 45s-3min before sending

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout"]);
const START_WORDS = new Set(["start", "unstop", "yes"]);
/** Pure runaway brake — loop/abuse/API-bill protection, NOT a handoff. The
 *  AI keeps answering until the prospect asks for a human or a question
 *  falls outside the program brief (the model then promises "Cole will …",
 *  which the alert email flags as YOUR TURN). No legit sales conversation
 *  gets near this number. */
const AI_REPLY_CAP = 30;

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
          // Outbound rows only — an sid collision must never clobber an
          // inbound row's "received" status.
          eq(smsSend.direction, "out"),
          // STRICT less-than: retried same-status callbacks are true no-ops
          // (no delivered_at re-stamping), and equal-rank terminal states
          // (delivered vs failed) can't overwrite each other.
          sql`case ${smsSend.status}
                when 'delivered' then 3 when 'undelivered' then 3 when 'failed' then 3
                when 'sent' then 2
                when 'queued' then 1 when 'accepted' then 1 when 'sending' then 1
                else 0 end < ${smsStatusRank(status)}`
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

  // Keyword detection on the LEADING word (skipping a courtesy "please"), not
  // the whole body collapsed — "Stop texting me" and "Please stop" are opt-outs
  // even though they aren't bare keywords, and neither Twilio's carrier-level
  // handling nor a collapsed-string compare catches them (2026-07-12 audit).
  // A false positive here costs one prospect (recoverable via START, and the
  // operator is paged); a false negative is a compliance violation.
  const words = body.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  const lead = (words[0] === "please" ? words[1] : words[0]) ?? "";
  const isStop = STOP_WORDS.has(lead);
  // "YES"/"START" are opt-in keywords ONLY for a number that actually opted
  // out — a mid-conversation "Yes" is the conversion signal, not bookkeeping.
  const [optedOutRow] = await db
    .select({ id: smsOptOut.id })
    .from(smsOptOut)
    .where(eq(smsOptOut.phone, from))
    .limit(1);
  const isStart = START_WORDS.has(lead) && !!optedOutRow;
  if (isStop) {
    await db
      .insert(smsOptOut)
      .values({ phone: from, reason: `replied ${body.toUpperCase()}` })
      .onConflictDoNothing();
  } else if (isStart) {
    await db.delete(smsOptOut).where(eq(smsOptOut.phone, from));
  }

  // Match the sender to a company profile. The thread belongs to whoever WE
  // texted: the most recent attributed outbound for this phone wins, so two
  // companies sharing an office line can't cross-contaminate context (the
  // digit-match fallback is sorted for determinism, not correctness).
  const digits = from.replace(/\D/g, "").replace(/^1/, "");
  const [companies, [lastAttributed]] = await Promise.all([
    db
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
      .from(prospectCompany),
    db
      .select({ company_key: smsSend.company_key })
      .from(smsSend)
      .where(
        and(eq(smsSend.phone, from), eq(smsSend.direction, "out"), isNotNull(smsSend.company_key))
      )
      .orderBy(desc(smsSend.created_at))
      .limit(1),
  ]);
  const match =
    (lastAttributed?.company_key
      ? companies.find((c) => c.key === lastAttributed.company_key)
      : undefined) ??
    companies
      .filter((c) => (c.phone ?? "").replace(/\D/g, "").replace(/^1/, "") === digits)
      .sort((a, b) => a.key.localeCompare(b.key))[0];

  const [inserted] = await db
    .insert(smsSend)
    .values({
      direction: "in",
      kind: "inbound",
      company_key: match?.key ?? null,
      phone: from,
      body,
      twilio_sid: inboundSid,
      status: "received",
    })
    .returning({ id: smsSend.id });

  // Twilio retries can slip past the select-then-insert dedupe when the first
  // invocation is still in flight (no unique constraint on twilio_sid, no
  // transactions). Deterministic winner election: every duplicate inserts,
  // then only the row with the smallest id proceeds to reply/alert.
  if (inboundSid && inserted) {
    const dupes = await db
      .select({ id: smsSend.id })
      .from(smsSend)
      .where(and(eq(smsSend.twilio_sid, inboundSid), eq(smsSend.direction, "in")));
    const winner = dupes.map((d) => d.id).sort()[0];
    if (winner !== inserted.id) {
      // Loser cleans up its own row so the thread doesn't show the text twice.
      await db.delete(smsSend).where(eq(smsSend.id, inserted.id));
      return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
        headers: { "Content-Type": "text/xml" },
      });
    }
  }

  // --- AI auto-reply, humanized (operator standing approval 2026-07-12) ------
  // Claude answers with the same rules as the draft button. The reply is
  // DELAYED 45s–3min (a human texting back, not a bot) via waitUntil — Twilio
  // gets its TwiML immediately. If the prospect texts again while we're
  // "typing", this invocation yields to the newer one so they get ONE reply
  // to their latest message. Cap: AI_REPLY_CAP per thread, then the human
  // takes over. Kill switch: SMS_AI_AUTOREPLY=0. STOP/opt-in keywords are
  // never answered, and sendSms refuses opted-out numbers regardless.
  if (!isStop && !isStart && !optedOutRow) {
    waitUntil(deferredAiReply({ from, body, inboundSid, match: match ?? null, base }));
  } else {
    // STOP/START/still-opted-out messages never enter the AI pipeline (no
    // Claude spend, no claim token minted for an opted-out number) — but the
    // operator still gets paged; "page on every inbound" has no exceptions.
    const to = process.env.ALERT_EMAIL;
    if (to) {
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const what = isStop ? "🚫 STOP" : isStart ? "✅ re-opted in (START)" : "💬 (opted-out number)";
      waitUntil(
        sendEmail({
          to,
          subject: `${what} — SMS from ${match?.name ?? from}`,
          html:
            `<p><strong>${esc(match?.name ?? from)}</strong> texted:</p>` +
            `<blockquote style="border-left:3px solid #b45309;margin:8px 0;padding:4px 12px;">${esc(body)}</blockquote>` +
            (isStop
              ? `<p>Number opted out — all sending to it is now blocked.</p>`
              : isStart
                ? `<p>Number re-opted in — sending unblocked.</p>`
                : `<p>This number is opted out; no reply was sent and none can be until they text START.</p>`),
          tags: { kind: "operator_alert" },
        }).catch(() => {})
      );
    }
  }

  // Empty TwiML so Twilio doesn't auto-reply or log an error.
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    headers: { "Content-Type": "text/xml" },
  });
}

type CompanyMatch = {
  key: string;
  name: string;
  id: string;
  trade: string;
  office_city: string | null;
  office_lat: number | null;
  office_lng: number | null;
} | null;

async function deferredAiReply(args: {
  from: string;
  body: string;
  inboundSid: string | null;
  match: CompanyMatch;
  base: string;
}) {
  const { from, body, inboundSid, match, base } = args;
  let aiReply: string | null = null;
  let aiIntent: SmsIntent | null = null;
  let aiCapped = false;
  // Every inbound text the AI hasn't answered yet — the alert quotes them all,
  // so a rapid-fire prospect's earlier messages aren't invisible to the
  // operator when only the newest invocation survives the supersede check.
  let unanswered: string[] = [body];
  try {
    if (process.env.SMS_AI_AUTOREPLY !== "0") {
      // Human-ish lag before "our" text appears.
      const delayMs = 45_000 + Math.floor(Math.random() * 135_000);
      await new Promise((r) => setTimeout(r, delayMs));

      const thread = await db
        .select({
          direction: smsSend.direction,
          body: smsSend.body,
          kind: smsSend.kind,
          twilio_sid: smsSend.twilio_sid,
          created_at: smsSend.created_at,
        })
        .from(smsSend)
        .where(eq(smsSend.phone, from))
        // id tiebreaker: equal timestamps must order the same way for every
        // concurrent invocation, or two racers can each think the OTHER is
        // newest and both yield (zero replies, zero alerts).
        .orderBy(asc(smsSend.created_at), asc(smsSend.id));

      // Yield if they texted again while we were "typing" — the newer
      // invocation replies to the full context instead.
      const inbounds = thread.filter((m) => m.direction === "in");
      const latestInbound = inbounds[inbounds.length - 1];
      const superseded = inboundSid && latestInbound?.twilio_sid !== inboundSid;

      // The trailing run of inbound messages = everything since our last text.
      const trailing: string[] = [];
      for (let i = thread.length - 1; i >= 0 && thread[i].direction === "in"; i--) {
        trailing.unshift(thread[i].body);
      }
      if (trailing.length) unanswered = trailing;

      // Runaway brake per 24h window — a lifetime count would eventually
      // silence the AI for exactly the long-lived repeat prospects it serves
      // best.
      const dayAgo = Date.now() - 24 * 3600_000;
      aiCapped =
        thread.filter((m) => m.kind === "ai_reply" && m.created_at.getTime() >= dayAgo).length >=
        AI_REPLY_CAP;
      if (!aiCapped && !superseded) {
        let claimUrl: string | null = null;
        let offeredPropertyId: string | null = null;
        let currentOpportunity: string | null = null;
        if (match) {
          const offers = await db
            .select({
              claim_url: buyerOutreach.claim_url,
              property_id: buyerOutreach.property_id,
              message: buyerOutreach.message,
            })
            .from(buyerOutreach)
            .where(eq(buyerOutreach.company_key, match.key))
            .orderBy(desc(buyerOutreach.sent_at))
            .limit(10);
          // One offer row grounds BOTH the link and the "current opportunity"
          // description — mixing rows made the AI describe property X while
          // linking property Y. The link is minted fresh (stored claim_url
          // may be past its 30-day token TTL).
          const withClaim = offers.find((o) => o.claim_url && o.property_id);
          if (withClaim) {
            claimUrl = freshClaimUrl(withClaim.property_id!, match.name, match.trade);
            offeredPropertyId = withClaim.property_id;
            currentOpportunity = withClaim.message
              ? `The opportunity already offered to them (from our email):\n${withClaim.message.slice(0, 500)}`
              : null;
          }
        }
        // Inventory loads for EVERY sender — unmatched numbers get links
        // minted with a blank company (the claim page asks them to fill it
        // in) scoped to the default metro. The AI can always answer "send me
        // something" with a real link.
        const inventory = await inventoryContextFor({
          companyName: match?.name ?? null,
          trade: match?.trade ?? "landscaping",
          lat: match?.office_lat ?? null,
          lng: match?.office_lng ?? null,
          excludePropertyId: offeredPropertyId,
        });
        const draft = await draftSmsReply({
          companyName: match?.name ?? null,
          city: match?.office_city ?? null,
          trade: match?.trade ?? null,
          claimUrl,
          currentOpportunity,
          inventory,
          thread: thread.map((m) => ({ direction: m.direction, body: m.body })),
        });
        if (draft) {
          // TCPA quiet hours: never auto-text a prospect outside 8am–9pm on
          // THEIR local clock, even in reply to an inbound. An 11pm "hey" must
          // not trigger an 11pm marketing auto-reply — the operator alert below
          // still fires, so Cole picks it up from the inbox in the morning.
          const tz = marketTz(match?.office_lat ?? null, match?.office_lng ?? null);
          if (withinTcpaHours(new Date(), tz)) {
            const res = await sendSms({
              to: from,
              body: draft.text,
              kind: "ai_reply",
              companyKey: match?.key ?? null,
              refId: match?.id ?? null,
            });
            if (res.ok) {
              aiReply = draft.text;
              aiIntent = draft.intent;
            }
          }
        }
      }
      if (superseded) return; // the newer invocation alerts + replies
    }
  } catch (e) {
    console.error("deferredAiReply failed:", e);
  }

  // Page the operator with both sides of the exchange. The AI signals a human
  // hand-off via its structured intent (not a regex over its prose — a
  // paraphrase like "I'll have Cole reach out" used to slip past the "Cole will"
  // match and silently strand the thread). A handoff, OR an inbound we couldn't
  // auto-answer (capped, or held for quiet hours), escalates to YOUR TURN.
  const to = process.env.ALERT_EMAIL;
  if (to) {
    const needsHuman = aiIntent === "handoff" || (!aiReply && !!match);
    const link = match ? `${base}/companies/${match.id}` : `${base}/messages/sms`;
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    await sendEmail({
      to,
      subject: `${needsHuman || aiCapped ? "🔔 YOUR TURN — " : "💬 "}SMS reply from ${match?.name ?? from}`,
      html:
        `<p><strong>${esc(match?.name ?? from)}</strong> texted:</p>` +
        unanswered
          .map(
            (m) =>
              `<blockquote style="border-left:3px solid #2f7d4f;margin:8px 0;padding:4px 12px;">${esc(m)}</blockquote>`
          )
          .join("") +
        (aiReply
          ? `<p>🤖 AI answered:</p><blockquote style="border-left:3px solid #2563eb;margin:8px 0;padding:4px 12px;">${esc(aiReply)}</blockquote>` +
            (needsHuman
              ? `<p>🔔 The AI promised <strong>you'd</strong> follow up personally — that promise is now yours to keep.</p>`
              : "")
          : aiCapped
            ? `<p>⚠️ Runaway brake tripped (${AI_REPLY_CAP} AI replies to this number in 24h) — <strong>your turn</strong>.</p>`
            : `<p>No AI reply was sent — reply yourself.</p>`) +
        `<p><a href="${link}">Open the thread</a> to take over any time.</p>`,
      tags: { kind: "operator_alert" },
    }).catch(() => {});
  }
}
