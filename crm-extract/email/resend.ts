// Resend integration: send + webhook signature verification.
//
// Ported from lib/integrations/resend.ts, generalized from two hardcoded
// "streams" to brand-aware sending, and with the send log repointed from a
// dedicated email_send table onto the CRM's unified `activity` timeline.
//
// Design decisions carried over deliberately:
//   - REST, not the SDK. One fetch, no dependency, no version churn.
//   - NEVER THROWS. Returns {ok:false,error}. A failed send must not take down
//     the page or the cron that triggered it.
//   - Always multipart. HTML-only mail is a bot signature spam filters penalize;
//     a plain-text part is derived from the HTML when the caller doesn't supply one.
//   - Per-brand FROM on separate verified domains, so a reputation problem on
//     one brand cannot land the other brand's mail in spam.
//   - Failure tripwire: N failed sends in a day pages ops once. sendEmail()
//     returning {ok:false} is invisible to a cron guard that only catches throws
//     — this is the thing that made a whole outage silent in the source app.

import crypto from "node:crypto";

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

export function getResendKey(): string | null {
  return process.env.RESEND_API_KEY ?? null;
}

/** Comma-separated list supported: each Resend webhook (sending vs receiving)
 *  has its OWN signing secret, and a single-secret check silently 401s the
 *  second one until Resend auto-disables it — a real 5-day outage in the source
 *  app. Accept any configured secret. */
export function getResendWebhookSecrets(): string[] {
  return (process.env.RESEND_WEBHOOK_SECRET ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Resolve the sender for a brand. Falls back to RESEND_FROM so a brand row
 *  without its own domain still sends rather than failing. */
export function fromForBrand(brand?: { from_email?: string | null } | null): string | null {
  return brand?.from_email || process.env.RESEND_FROM || null;
}

/** Plain-text alternative derived from our simple email HTML. */
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

// --- failure tripwire -------------------------------------------------------

const FAIL_ALERT_AT = Number(process.env.EMAIL_FAIL_ALERT_AT) || 10;

async function noteSendFailure(error: string): Promise<void> {
  try {
    const { db } = await import("../db");
    const { usageCounter } = await import("../db/schema");
    const { sql } = await import("drizzle-orm");
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const [row] = await db
      .insert(usageCounter)
      .values({ key: "emailfail:day", window_start: day, count: 1 })
      .onConflictDoUpdate({
        target: [usageCounter.key, usageCounter.window_start],
        set: { count: sql`${usageCounter.count} + 1` },
      })
      .returning({ count: usageCounter.count });
    if ((row?.count ?? 0) !== FAIL_ALERT_AT) return; // exactly once per day
    console.error(
      `[email-fail tripwire] ${FAIL_ALERT_AT}+ sends failed today (latest: ${error.slice(0, 120)})`
    );
    // Deliberately console-only: emailing about broken email is a loop. Wire
    // this to SMS/Slack in the new app — see PACKET.md → rough edges.
  } catch {
    /* the tripwire must never break a send path */
  }
}

// --- send -------------------------------------------------------------------

export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  /** Plain-text part; derived from html when omitted (never sent html-only). */
  text?: string;
  /** Brand identity to send as. Omit for ops/internal mail. */
  brand?: { from_email?: string | null; reply_to_email?: string | null } | null;
  tags?: Record<string, string>;
  /** Extra SMTP headers (e.g. List-Unsubscribe for one-click opt-out). */
  headers?: Record<string, string>;
  replyTo?: string;
  /** Log this send onto the CRM timeline. Every buyer-facing path should set
   *  this: "if it sends, it logs". The returned Resend message id is stored as
   *  activity.external_id so the webhook can attach delivery state to the same
   *  row that carries the body. */
  logAs?: {
    companyId: string;
    contactId?: string | null;
    dealId?: string | null;
    brandId?: string | null;
    actorUserId?: string | null;
  };
}): Promise<SendResult> {
  const key = getResendKey();
  const from = fromForBrand(args.brand);
  if (!key) return { ok: false, error: "RESEND_API_KEY not set" };
  if (!from) return { ok: false, error: "No sender configured (brand.from_email / RESEND_FROM)" };

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
        tracking: { opens: true, clicks: true },
        tags: args.tags
          ? Object.entries(args.tags).map(([name, value]) => ({ name, value }))
          : undefined,
        reply_to: args.replyTo ?? args.brand?.reply_to_email ?? process.env.RESEND_REPLY_TO ?? undefined,
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
        const { activity } = await import("../db/schema");
        await db.insert(activity).values({
          company_id: args.logAs.companyId,
          contact_id: args.logAs.contactId ?? null,
          deal_id: args.logAs.dealId ?? null,
          brand_id: args.logAs.brandId ?? null,
          kind: "email_out",
          subject: args.subject,
          body: args.text ?? htmlToText(args.html),
          email_address: args.to,
          external_id: data.id,
          actor_user_id: args.logAs.actorUserId ?? null,
        });
      } catch (e) {
        console.error("activity log failed (send succeeded):", e);
      }
    }
    return { ok: true, id: data.id };
  } catch (e) {
    const error = e instanceof Error ? e.message : "send failed";
    await noteSendFailure(error);
    return { ok: false, error };
  }
}

// --- webhook signature ------------------------------------------------------

/**
 * Verify a Resend (Svix) webhook signature. Signed content is
 * `${id}.${timestamp}.${rawBody}`, HMAC-SHA256 with the base64 secret after the
 * "whsec_" prefix, compared against the `v1,<sig>` entries.
 *
 * FAILS CLOSED when a secret is configured but doesn't match. Allows through
 * only when NO secret is configured (local dev) — in production an unsigned
 * webhook could forge complaints (suppressing arbitrary addresses) or fake
 * inbound replies onto a company's timeline.
 */
export function verifyResendSignature(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null }
): boolean {
  const secrets = getResendWebhookSecrets();
  if (!secrets.length) return true; // dev only
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  return secrets.some((secret) => {
    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const expected = crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64");
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
  });
}
