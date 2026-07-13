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

/** Neutralize URLs in attacker-controlled body text so a mail client won't
 *  auto-link them — the operator opens every reply (it's the conversion
 *  event), so a live link from an unverified sender is a phishing click
 *  waiting to happen. `http://evil.com/x` -> `hxxp://evil[.]com/x`. */
function defangLinks(s: string): string {
  return s
    .replace(/\bhttps?:\/\/\S+/gi, (u) => u.replace(/^http/i, "hxxp").replace(/\./g, "[.]"))
    .replace(/\bwww\.\S+/gi, (u) => u.replace(/\./g, "[.]"));
}

export async function alertOperatorOfReply(p: {
  from: string | null;
  fromEmail: string | null;
  subject: string | null;
  text: string;
  /** True only when SES SPF+DKIM both PASSed — otherwise the From is unproven. */
  verified?: boolean;
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
      (p.verified
        ? ""
        : `<p style="margin:0 0 10px;padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:12px;color:#991b1b;">⚠️ Unverified sender — SPF/DKIM did not pass. The From address and links below are <strong>not proven</strong>; treat any link as untrusted.</p>`) +
      `<p style="margin:0 0 6px;"><strong>${esc(p.from ?? "Unknown sender")}</strong> replied to leads@:</p>` +
      (profile
        ? `<p style="margin:0 0 12px;"><a href="${base}/companies/${profile.id}" style="color:#2f7d4f;font-weight:600;">${esc(profile.name)} — open company profile ↗</a></p>`
        : `<p style="margin:0 0 12px;color:#9ca3af;">No matching company profile.</p>`) +
      // Body: escape HTML, then defang URLs so nothing in the untrusted body is clickable.
      `<pre style="white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;font-size:13px;">${esc(defangLinks(p.text.slice(0, 4000)) || "(empty body)")}</pre>` +
      `<p style="margin:12px 0 0;font-size:12px;color:#9ca3af;">Hit reply on this email to answer ${esc(p.fromEmail ?? "the sender")} directly.</p>` +
      `</div>`,
    replyTo: p.fromEmail ?? undefined,
    tags: { kind: "inbound_alert" },
  });
  if (!res.ok) console.error(`inbound reply alert send failed: ${res.error}`);
  else console.log(`inbound reply: alerted ${alertTo} about ${p.fromEmail ?? "?"}`);
}
