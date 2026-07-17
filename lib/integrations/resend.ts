// Resend email integration: send transactional proposal emails with open/click
// tracking, and verify inbound webhook signatures so we can record opens.
//
// The deployed app cannot call MCP tools, so this uses Resend's REST API with a
// server-side key. Sending is guarded behind explicit operator action elsewhere
// (build spec section 9: no sends without approval).

import crypto from "node:crypto";
import { isPlaceholderEmail } from "../buyer-auth";

export function getResendKey(): string | null {
  return process.env.RESEND_API_KEY ?? null;
}
export function getResendFrom(stream: "transactional" | "campaign" = "transactional"): string | null {
  // e.g. "Cole @ NW Houston Grounds <cole@yourverifieddomain.com>"
  // Cold outreach and transactional mail (magic links, receipts) should send
  // from DIFFERENT domains: our auth IS email, so a cold-spam reputation hit on
  // the primary domain would land magic links in spam and lock buyers out of a
  // passwordless product. Set CAMPAIGN_EMAIL_FROM to a verified COUSIN domain
  // (e.g. greenkeepmail.com) to isolate campaign reputation; until then, cold
  // sends fall back to the primary so nothing breaks. See security-followups.md.
  if (stream === "campaign" && process.env.CAMPAIGN_EMAIL_FROM) {
    return process.env.CAMPAIGN_EMAIL_FROM;
  }
  return process.env.RESEND_FROM ?? null;
}
export function getResendWebhookSecret(): string | null {
  return process.env.RESEND_WEBHOOK_SECRET ?? null;
}

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Send an email via Resend with open + click tracking enabled. `tags` ride along
 * and come back on webhook events (we tag the outreach id so opens map back).
 * Returns the Resend message id on success. Never throws.
 */
/** Plain-text alternative derived from our simple email HTML. HTML-only mail
 *  is a bot signature spam filters mildly penalize (human mail clients always
 *  send multipart) — every send gets a text part, derived here unless the
 *  caller passes a higher-fidelity one. Handles the shapes our builders emit:
 *  inline-styled <p>/<br>/<a> with escaped entities. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|li|tr)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Failure tripwire (2026-07-17 audit): sendEmail never throws and the cron
// guard only pages on a thrown exception, so a Resend rate-limit/outage day
// used to fail SILENTLY — the engines kept spending Apollo/scrape/ATTOM quota
// while zero mail delivered, rows thrashed queued→sent→queued, and nothing
// alerted. Count real send failures per UTC day; on crossing the threshold,
// alert the operator ONCE — by SMS, because when Resend is down an email
// alert dies with it. Set ALERT_SMS_TO (E.164) to arm the SMS channel.
const EMAIL_FAIL_ALERT_AT = 10;
async function noteSendFailure(error: string): Promise<void> {
  try {
    const { db } = await import("../db");
    const { usageCounter } = await import("../db/schema");
    const { sql } = await import("drizzle-orm");
    const day = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000);
    const [row] = await db
      .insert(usageCounter)
      .values({ key: "emailfail:day", window_start: day, count: 1 })
      .onConflictDoUpdate({
        target: [usageCounter.key, usageCounter.window_start],
        set: { count: sql`${usageCounter.count} + 1` },
      })
      .returning({ count: usageCounter.count });
    if ((row?.count ?? 0) !== EMAIL_FAIL_ALERT_AT) return; // exactly once per day
    const body =
      `Greenkeep ops: ${EMAIL_FAIL_ALERT_AT}+ email sends failed today ` +
      `(latest: ${error.slice(0, 100)}). If Resend is rate-limited, the outreach ` +
      `engines are burning Apollo/scrape spend with nothing delivered.`;
    const to = process.env.ALERT_SMS_TO ?? null;
    if (to) {
      const { sendSms } = await import("./twilio");
      await sendSms({ to, body, kind: "ops_alert" });
    } else {
      console.error(`[email-fail tripwire] ${body} (set ALERT_SMS_TO to get this as an SMS)`);
    }
  } catch {
    // the tripwire itself must never break a send path
  }
}

export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  /** Plain-text part; derived from html when omitted (never sent html-only). */
  text?: string;
  tags?: Record<string, string>;
  /** Extra SMTP headers (e.g. List-Unsubscribe for one-click opt-out). */
  headers?: Record<string, string>;
  /** Where replies land (falls back to RESEND_REPLY_TO, then the from
   *  address). Replies ARE the conversion event — route them somewhere
   *  watched. */
  replyTo?: string;
  /** Log this send to email_send so the engagement webhook can attribute
   *  opens/clicks. REQUIRED for any buyer-facing one-off path (the
   *  instrumentation rule: if it sends, it logs — docs/instrumentation.md).
   *  Campaign sends that already persist their message id in a domain table
   *  (buyer_outreach/outreach) skip this. Best-effort: a log failure never
   *  fails the send. */
  logAs?: { kind: string; buyerId?: string | null; refId?: string | null };
  /** "campaign" routes cold outreach through CAMPAIGN_EMAIL_FROM (a cousin
   *  domain) to protect the primary domain's transactional reputation.
   *  Defaults to "transactional" (magic links, receipts, alerts). */
  stream?: "transactional" | "campaign";
}): Promise<SendResult> {
  const key = getResendKey();
  const from = getResendFrom(args.stream);
  if (!key) return { ok: false, error: "RESEND_API_KEY not set" };
  if (!from) return { ok: false, error: "RESEND_FROM not set (verified domain sender)" };
  // Phone-only buyers carry an internal placeholder address (lib/buyer-auth)
  // that is not a mailbox — mailing it would hard-bounce and burn domain
  // reputation. Central refusal so no caller has to remember.
  if (isPlaceholderEmail(args.to)) {
    return { ok: false, error: "placeholder address (phone-only buyer) — reach them by SMS" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        text: args.text ?? htmlToText(args.html),
        // Resend open/click tracking (also enable at the domain level in Resend).
        tracking: { opens: true, clicks: true },
        tags: args.tags
          ? Object.entries(args.tags).map(([name, value]) => ({ name, value }))
          : undefined,
        reply_to: args.replyTo ?? process.env.RESEND_REPLY_TO ?? undefined,
        headers: args.headers,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !data.id) {
      const error = data.message || `HTTP ${res.status}`;
      await noteSendFailure(error);
      return { ok: false, error };
    }
    if (args.logAs) {
      try {
        const { db } = await import("../db");
        const { emailSend } = await import("../db/schema");
        await db.insert(emailSend).values({
          kind: args.logAs.kind,
          buyer_id: args.logAs.buyerId ?? null,
          ref_id: args.logAs.refId ?? null,
          to_email: args.to,
          subject: args.subject,
          resend_message_id: data.id,
        });
      } catch (e) {
        console.error("email_send log failed (send succeeded):", e);
      }
    }
    return { ok: true, id: data.id };
  } catch (e) {
    const error = e instanceof Error ? e.message : "send failed";
    await noteSendFailure(error);
    return { ok: false, error };
  }
}

/**
 * Verify a Resend (Svix) webhook signature. Headers: svix-id, svix-timestamp,
 * svix-signature; signed content is `${id}.${timestamp}.${rawBody}` HMAC-SHA256
 * with the base64 secret (after the "whsec_" prefix), compared to the v1, sig.
 * Returns true when no secret is configured? No — fail closed if a secret is set
 * but verification fails; allow through only when no secret is configured (dev).
 */
export function verifyResendSignature(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null }
): boolean {
  const secret = getResendWebhookSecret();
  if (!secret) return true; // no secret configured (dev) — accept
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");

  // svix-signature is space-separated "v1,<sig>" entries; any match passes.
  return signature.split(" ").some((part) => {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    try {
      return (
        sig.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
      );
    } catch {
      return false;
    }
  });
}
