// Twilio SMS integration. Same shape as resend.ts: plain REST (no SDK),
// never throws, and every message logs an sms_send row (docs/instrumentation.md
// — if it sends, it logs). Delivery state arrives via the status callback on
// /api/webhooks/twilio; inbound replies land there too.
//
// Compliance posture: outbound SMS here is operator-initiated, one-to-one,
// to a business number we're already in a thread with (reply/follow-up), not
// bulk cold blasts — TCPA treats texts like calls, so keep it that way. Every
// send checks sms_opt_out first, and STOP replies are honored both by Twilio
// (carrier-level) and in our ledger.

import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { smsOptOut, smsSend } from "@/lib/db/schema";

export type SmsResult = { ok: true; sid: string } | { ok: false; error: string };

function creds(): { sid: string; token: string; from: string | null; serviceSid: string | null } | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM || null; // the purchased number, E.164
  // When set, sends go out via the Messaging Service's sender pool (local +
  // toll-free) instead of the single number: Twilio picks the sender, keeps
  // it STICKY per recipient (threads never fracture across numbers), and
  // scales/fails over as volume grows. Unset = single-number behavior.
  // Either sender source alone is a valid config.
  const serviceSid = process.env.TWILIO_MESSAGING_SERVICE_SID || null;
  return sid && token && (from || serviceSid) ? { sid, token, from, serviceSid } : null;
}

/** Best-effort US number → E.164. Returns null if it doesn't look like one. */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.trim().startsWith("+") && digits.length >= 11) return `+${digits}`;
  return null;
}

export async function isSmsOptedOut(phoneE164: string): Promise<boolean> {
  const [row] = await db
    .select({ id: smsOptOut.id })
    .from(smsOptOut)
    .where(eq(smsOptOut.phone, phoneE164))
    .limit(1);
  return !!row;
}

/**
 * Send one SMS and log it. `to` may be any US-format number (normalized here).
 * Refuses opted-out numbers. Returns the Twilio message SID on success.
 */
export async function sendSms(args: {
  to: string;
  body: string;
  kind: string;
  companyKey?: string | null;
  buyerId?: string | null;
  refId?: string | null;
}): Promise<SmsResult> {
  const c = creds();
  if (!c) {
    return {
      ok: false,
      error:
        "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN plus TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID not set",
    };
  }
  const to = toE164(args.to);
  if (!to) return { ok: false, error: `not a valid US number: ${args.to}` };
  const body = args.body.trim().slice(0, 1200); // ~8 segments hard stop
  if (!body) return { ok: false, error: "empty message" };
  if (await isSmsOptedOut(to)) return { ok: false, error: "number has opted out (STOP)" };

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const params = new URLSearchParams({ To: to, Body: body });
  if (c.serviceSid) params.set("MessagingServiceSid", c.serviceSid);
  else params.set("From", c.from!); // creds() guarantees one of the two
  if (base) params.set("StatusCallback", `${base}/api/webhooks/twilio`);

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${c.sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${c.sid}:${c.token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      }
    );
    const data = (await res.json()) as { sid?: string; status?: string; message?: string };
    if (!res.ok || !data.sid) {
      return { ok: false, error: data.message ?? `Twilio HTTP ${res.status}` };
    }
    await db
      .insert(smsSend)
      .values({
        direction: "out",
        kind: args.kind,
        company_key: args.companyKey ?? null,
        buyer_id: args.buyerId ?? null,
        ref_id: args.refId ?? null,
        phone: to,
        body,
        twilio_sid: data.sid,
        status: data.status ?? "queued",
      })
      .catch((e) => console.error("sms_send log failed:", e)); // log failure never fails the send
    return { ok: true, sid: data.sid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Delivery-state rank — status callbacks can arrive out of order (a late
 * "sent" after "delivered"), so updates must never move a message backwards.
 * Terminal states rank equal so a retried callback is an idempotent no-op.
 */
export function smsStatusRank(status: string): number {
  switch (status) {
    case "delivered":
    case "undelivered":
    case "failed":
      return 3;
    case "sent":
      return 2;
    case "queued":
    case "accepted":
    case "sending":
      return 1;
    default:
      return 0;
  }
}

/**
 * Validate X-Twilio-Signature: base64(HMAC-SHA1(url + sorted(key+value)…)).
 * `url` must be the EXACT public URL Twilio hit (scheme + host + path).
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null
): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  const expected = crypto.createHmac("sha1", token).update(data).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
