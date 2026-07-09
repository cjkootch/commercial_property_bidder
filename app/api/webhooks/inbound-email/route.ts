import { NextRequest } from "next/server";
import { parseInboundEmail } from "@/lib/email/inbound";
import { alertOperatorOfReply } from "@/lib/email/reply-alert";

// Inbound email (replies to leads@): AWS SES receives for the domain (MX ->
// inbound-smtp), a receipt rule publishes each message to an SNS topic, and
// SNS POSTs here. We alert the operator instantly (ALERT_EMAIL) and link the
// sender to their company profile when the address matches the graph —
// replies are the conversion event, they must never sit unseen.
//
// Auth: SNS can't send custom headers, so the subscription URL carries
// ?key=<INBOUND_WEBHOOK_SECRET or CRON_SECRET>. SubscriptionConfirmation is
// completed automatically by fetching the SubscribeURL.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SnsEnvelope = {
  Type?: string;
  SubscribeURL?: string;
  Message?: string;
};

type SesNotification = {
  notificationType?: string;
  mail?: { source?: string; destination?: string[] };
  content?: string; // raw MIME, base64 when base64Encoded, else utf8
};

export async function POST(req: NextRequest) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET || process.env.CRON_SECRET;
  if (!secret || req.nextUrl.searchParams.get("key") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let env: SnsEnvelope;
  try {
    env = (await req.json()) as SnsEnvelope;
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  // One-time handshake: confirm the SNS subscription by fetching its URL
  // (only ever an sns.<region>.amazonaws.com URL; guard anyway).
  if (env.Type === "SubscriptionConfirmation" && env.SubscribeURL) {
    if (/^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//.test(env.SubscribeURL)) {
      await fetch(env.SubscribeURL).catch(() => null);
      console.log("inbound-email: SNS subscription confirmed");
      return new Response("confirmed", { status: 200 });
    }
    return new Response("Bad SubscribeURL", { status: 400 });
  }

  if (env.Type !== "Notification" || !env.Message) return new Response("ok", { status: 200 });

  let note: SesNotification;
  try {
    note = JSON.parse(env.Message) as SesNotification;
  } catch {
    return new Response("ok", { status: 200 });
  }

  // Decode the raw message. SES SNS content is base64 in practice; fall back
  // to treating it as text if decoding produces garbage.
  let raw = note.content ?? "";
  if (raw && !/^(From|Received|Return-Path|DKIM|Delivered-To):/im.test(raw.slice(0, 2000))) {
    try {
      const decoded = Buffer.from(raw, "base64").toString("utf8");
      if (/^(From|Received|Return-Path|DKIM|Delivered-To):/im.test(decoded.slice(0, 2000))) raw = decoded;
    } catch {
      /* keep raw */
    }
  }
  const parsed = raw
    ? parseInboundEmail(raw)
    : { from: note.mail?.source ?? null, fromEmail: note.mail?.source?.toLowerCase() ?? null, subject: null, text: "(no content in notification — enable message content in the SES receipt rule)" };

  await alertOperatorOfReply(parsed);
  return new Response("ok", { status: 200 });
}
