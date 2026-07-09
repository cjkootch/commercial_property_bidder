// The operator alert for an inbound reply — replies are the conversion event
// of the whole outreach machine, so they must reach a human within a minute.
// Shared by both inbound paths (Resend email.received webhook; the SES/SNS
// endpoint kept for a direct-AWS setup). Matches the sender to their company
// profile (exact email, then site domain) and sends to ALERT_EMAIL with
// reply-to set to the prospect, so replying to the alert replies to them.

import { eq, like, or } from "drizzle-orm";
import { db } from "../db";
import { prospectCompany } from "../db/schema";
import { sendEmail } from "../integrations/resend";

export function emailAddressOf(from: string | null | undefined): string | null {
  if (!from) return null;
  return (
    from.match(/<([^>]+)>/)?.[1]?.toLowerCase() ??
    from.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() ??
    null
  );
}

export async function alertOperatorOfReply(p: {
  from: string | null;
  fromEmail: string | null;
  subject: string | null;
  text: string;
}): Promise<void> {
  // Match the sender to the company graph: exact email first, then domain.
  let profile: { id: string; name: string } | null = null;
  if (p.fromEmail) {
    const domain = p.fromEmail.split("@")[1] ?? "";
    const rows = await db
      .select({ id: prospectCompany.id, name: prospectCompany.name, email: prospectCompany.email })
      .from(prospectCompany)
      .where(
        or(
          eq(prospectCompany.email, p.fromEmail),
          domain ? like(prospectCompany.website, `%${domain}%`) : eq(prospectCompany.email, p.fromEmail)
        )
      )
      .limit(2);
    profile = rows.find((r) => r.email === p.fromEmail) ?? rows[0] ?? null;
  }

  const alertTo = process.env.ALERT_EMAIL;
  if (!alertTo) {
    console.error("inbound reply received but ALERT_EMAIL is not set — nobody was alerted");
    return;
  }

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://greenkeep.us").replace(/\/$/, "");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const res = await sendEmail({
    to: alertTo,
    subject: `📬 Reply from ${p.from ?? p.fromEmail ?? "unknown sender"}${p.subject ? ` — ${p.subject}` : ""}`,
    html:
      `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;line-height:1.55;">` +
      `<p style="margin:0 0 6px;"><strong>${esc(p.from ?? "Unknown sender")}</strong> replied to leads@:</p>` +
      (profile
        ? `<p style="margin:0 0 12px;"><a href="${base}/companies/${profile.id}" style="color:#2f7d4f;font-weight:600;">${esc(profile.name)} — open company profile ↗</a></p>`
        : `<p style="margin:0 0 12px;color:#9ca3af;">No matching company profile.</p>`) +
      `<pre style="white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;font-size:13px;">${esc(p.text.slice(0, 4000) || "(empty body)")}</pre>` +
      `<p style="margin:12px 0 0;font-size:12px;color:#9ca3af;">Hit reply on this email to answer ${esc(p.fromEmail ?? "the sender")} directly.</p>` +
      `</div>`,
    replyTo: p.fromEmail ?? undefined,
    tags: { kind: "inbound_alert" },
  });
  if (!res.ok) console.error(`inbound reply alert send failed: ${res.error}`);
  else console.log(`inbound reply: alerted ${alertTo} about ${p.fromEmail ?? "?"}`);
}
