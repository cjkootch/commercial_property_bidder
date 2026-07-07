// Resend email integration: send transactional proposal emails with open/click
// tracking, and verify inbound webhook signatures so we can record opens.
//
// The deployed app cannot call MCP tools, so this uses Resend's REST API with a
// server-side key. Sending is guarded behind explicit operator action elsewhere
// (build spec section 9: no sends without approval).

import crypto from "node:crypto";

export function getResendKey(): string | null {
  return process.env.RESEND_API_KEY ?? null;
}
export function getResendFrom(): string | null {
  // e.g. "Cole @ NW Houston Grounds <cole@yourverifieddomain.com>"
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
export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  tags?: Record<string, string>;
  /** Extra SMTP headers (e.g. List-Unsubscribe for one-click opt-out). */
  headers?: Record<string, string>;
}): Promise<SendResult> {
  const key = getResendKey();
  const from = getResendFrom();
  if (!key) return { ok: false, error: "RESEND_API_KEY not set" };
  if (!from) return { ok: false, error: "RESEND_FROM not set (verified domain sender)" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        // Resend open/click tracking (also enable at the domain level in Resend).
        tracking: { opens: true, clicks: true },
        tags: args.tags
          ? Object.entries(args.tags).map(([name, value]) => ({ name, value }))
          : undefined,
        headers: args.headers,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !data.id) return { ok: false, error: data.message || `HTTP ${res.status}` };
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
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
