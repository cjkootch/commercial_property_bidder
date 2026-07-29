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
// No cycle: undeliverable.ts imports only db + schema.
import { isUndeliverable, recordSmsFailure } from "@/lib/sms/undeliverable";

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

/** A 10-digit US national number that is STRUCTURALLY dialable under the North
 *  American Numbering Plan. Catches the garbage that a digit-count check lets
 *  through — all-same-digit scrapes (0000000000, 6666666666), invalid area
 *  codes / exchanges (must start 2-9), and N11 service codes (X11). These
 *  otherwise pass toE164, error at Twilio ("not a valid number"), don't log,
 *  and get re-selected + re-Apollo-revealed every run (2026-07-13 launch). */
function isValidNanp(ten: string): boolean {
  if (!/^\d{10}$/.test(ten)) return false;
  if (/^(\d)\1{9}$/.test(ten)) return false; // all identical digits
  const area = ten.slice(0, 3);
  const exch = ten.slice(3, 6);
  if (!/^[2-9]/.test(area) || !/^[2-9]/.test(exch)) return false; // NXX rule
  if (/^\d11$/.test(area) || /^\d11$/.test(exch)) return false; // N11 (211..911, X11)
  return true;
}

/** Best-effort US number → E.164. Returns null if it doesn't look like a
 *  valid, dialable US number (structural NANP check, not just digit count). */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  let national: string | null = null;
  if (digits.length === 10) national = digits;
  else if (digits.length === 11 && digits.startsWith("1")) national = digits.slice(1);
  else if (raw.trim().startsWith("+") && digits.length >= 11 && !digits.startsWith("1")) {
    return `+${digits}`; // non-US international — pass through, can't NANP-validate
  } else {
    return null;
  }
  return isValidNanp(national) ? `+1${national}` : null;
}

/** Line-type verdict from Twilio Lookup v2. "mobile" | "voip" | "landline" |
 *  "unknown"; a carrier-unmapped value is passed through verbatim. We text
 *  mobile + voip, skip landline + toll-free (owner cells are often VoIP). */
export type LineType = string;

/** Twilio Lookup line types we DON'T text. A landline or toll-free number is
 *  a business main line — it won't reach the owner's cell and SMS to it is
 *  rejected, burning a cap slot. fixedVoip is added from the 2026-07-13 launch
 *  batch: every fixedVoip number we texted bounced with carrier error 30006 —
 *  fixedVoip is location-bound office phone systems (RingCentral/8x8/PBX) that
 *  don't accept consumer A2P SMS. nonFixedVoip (Google Voice / TextNow, i.e. an
 *  owner's VoIP cell) stays textable, as does mobile.
 *
 *  "unknown" is on the list from the 2026-07-28 review, and the distinction it
 *  turns on is worth stating: a NULL line_type means we never asked, which can
 *  be a Lookup outage, so it stays textable — a screen must never silence the
 *  queue. The literal string "unknown" means we DID ask and Twilio could not
 *  classify the number, which is a negative signal, not a missing one. Texting
 *  those anyway ran 85.7% undelivered across the 449 companies carrying that
 *  verdict. Absence of evidence and evidence of absence are different things,
 *  and the original predicate conflated them. */
const NON_TEXTABLE_LINE_TYPES = new Set(["landline", "tollFree", "fixedVoip", "unknown"]);
export function isTextableLineType(lineType: string | null | undefined): boolean {
  return !lineType || !NON_TEXTABLE_LINE_TYPES.has(lineType);
}

/**
 * Twilio Lookup v2 line_type_intelligence — one number, one HTTP call.
 * Returns the line type ("mobile" | "landline" | "voip" | …) or null on any
 * failure (never throws; callers treat null as "unknown / not screened").
 * ~$0.008 per lookup — callers MUST cache the result, not re-query per send.
 */
export async function lookupLineType(raw: string): Promise<LineType | null> {
  const c = creds();
  if (!c) return null;
  const to = toE164(raw);
  if (!to) return null;
  try {
    const res = await fetch(
      `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(to)}?Fields=line_type_intelligence`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${c.sid}:${c.token}`).toString("base64")}`,
        },
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      line_type_intelligence?: { type?: string | null } | null;
    };
    // A valid lookup for an unrecognized number returns the field as null; we
    // record "unknown" so it's marked screened (won't re-cost) yet stays
    // textable under the fail-open rule.
    return data.line_type_intelligence?.type ?? "unknown";
  } catch {
    return null;
  }
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
  // Central guard. The queue, hold-expiry and long-tail each filter on this
  // too, but those are optimizations that stop a doomed candidate being picked;
  // THIS is the guarantee. Every send path funnels through here — including
  // smoke tests and any future caller that forgets — so a number a carrier has
  // already rejected cannot be retried from anywhere.
  if (await isUndeliverable(to)) {
    return { ok: false, error: "number is permanently undeliverable (prior carrier rejection)" };
  }

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
    const data = (await res.json()) as {
      sid?: string;
      status?: string;
      message?: string;
      /** The sender Twilio actually used. With a Messaging Service this is
       *  chosen from the pool, so it is the only place the real sender appears
       *  — it can be null while the message is still queued, in which case the
       *  status callback backfills it. */
      from?: string | null;
      /** Twilio's numeric error code on a rejected request (e.g. 21211). */
      code?: number | string | null;
    };
    if (!res.ok || !data.sid) {
      // A rejected send writes no sms_send row — that is why 3,122 of these
      // were invisible to the app while Twilio counted every one. Record the
      // verdict so the number is never submitted again. Permanent codes only;
      // a transient failure must not condemn a good number.
      if (data.code != null) {
        await recordSmsFailure(to, String(data.code));
      }
      return {
        ok: false,
        error: data.message ?? `Twilio HTTP ${res.status}${data.code ? ` (${data.code})` : ""}`,
      };
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
        our_number: data.from ?? c.from ?? null,
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
