import { NextRequest } from "next/server";
import { eq, or, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { prospectCompany } from "@/lib/db/schema";
import { sendEmail } from "@/lib/integrations/resend";
import { parseInboundEmail } from "@/lib/email/inbound";

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

  // Match the sender to the company graph: exact email first, then domain.
  let profile: { id: string; name: string } | null = null;
  if (parsed.fromEmail) {
    const domain = parsed.fromEmail.split("@")[1] ?? "";
    const rows = await db
      .select({ id: prospectCompany.id, name: prospectCompany.name, email: prospectCompany.email })
      .from(prospectCompany)
      .where(
        or(
          eq(prospectCompany.email, parsed.fromEmail),
          domain ? like(prospectCompany.website, `%${domain}%`) : eq(prospectCompany.email, parsed.fromEmail)
        )
      )
      .limit(2);
    profile = rows.find((r) => r.email === parsed.fromEmail) ?? rows[0] ?? null;
  }

  const alertTo = process.env.ALERT_EMAIL;
  if (!alertTo) {
    console.error("inbound-email: reply received but ALERT_EMAIL is not set — nobody was alerted");
    return new Response("ok", { status: 200 });
  }

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://greenkeep.us").replace(/\/$/, "");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const res = await sendEmail({
    to: alertTo,
    subject: `📬 Reply from ${parsed.from ?? parsed.fromEmail ?? "unknown sender"}${parsed.subject ? ` — ${parsed.subject}` : ""}`,
    html:
      `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;line-height:1.55;">` +
      `<p style="margin:0 0 6px;"><strong>${esc(parsed.from ?? "Unknown sender")}</strong> replied to leads@:</p>` +
      (profile
        ? `<p style="margin:0 0 12px;"><a href="${base}/companies/${profile.id}" style="color:#2f7d4f;font-weight:600;">${esc(profile.name)} — open company profile ↗</a></p>`
        : `<p style="margin:0 0 12px;color:#9ca3af;">No matching company profile.</p>`) +
      `<pre style="white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;font-size:13px;">${esc(parsed.text || "(empty body)")}</pre>` +
      `<p style="margin:12px 0 0;font-size:12px;color:#9ca3af;">Reply directly to this email? No — reply to the sender: ${esc(parsed.fromEmail ?? "unknown")}</p>` +
      `</div>`,
    replyTo: parsed.fromEmail ?? undefined,
    tags: { kind: "inbound_alert" },
  });
  if (!res.ok) console.error(`inbound-email: alert send failed: ${res.error}`);
  else console.log(`inbound-email: alerted ${alertTo} about reply from ${parsed.fromEmail ?? "?"}`);

  return new Response("ok", { status: 200 });
}
