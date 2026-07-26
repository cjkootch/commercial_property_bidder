// Internal ops alerts — the events that must never sit unseen. Ported from
// lib/email/operator-alerts.ts. Everything here is best-effort: an alert failure
// must never break the flow that triggered it.
//
// These send WITHOUT a brand (no outward-facing identity) and go to ALERT_EMAIL.

import { sendEmail } from "./resend";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function alertOps(subject: string, lines: string[]): Promise<void> {
  const to = process.env.ALERT_EMAIL;
  if (!to) {
    console.error(`ops alert dropped (ALERT_EMAIL not set): ${subject}`);
    return;
  }
  try {
    await sendEmail({
      to,
      subject,
      html:
        `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6">` +
        lines.filter(Boolean).map((l) => `<p style="margin:0 0 6px">${esc(l)}</p>`).join("") +
        `</div>`,
      tags: { kind: "ops_alert" },
    });
  } catch (e) {
    console.error("ops alert failed:", e);
  }
}

/** An inbound reply landed — the conversion event of any origination program. */
export async function alertInboundReply(p: {
  from: string;
  companyName: string | null;
  companyId: string | null;
  subject: string | null;
  body: string;
  baseUrl: string;
}): Promise<void> {
  const to = process.env.ALERT_EMAIL;
  if (!to) return;
  const who = p.companyName ?? p.from;
  await sendEmail({
    to,
    subject: `💬 Reply from ${who}`,
    // reply-to the prospect so hitting Reply in the alert answers THEM.
    replyTo: p.from,
    html:
      `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6">` +
      `<p style="margin:0 0 8px"><strong>${esc(who)}</strong> replied${
        p.subject ? ` — ${esc(p.subject)}` : ""
      }:</p>` +
      `<blockquote style="margin:0 0 12px;padding:8px 12px;border-left:3px solid #d1d5db;color:#374151;white-space:pre-wrap">${esc(
        p.body.slice(0, 4000)
      )}</blockquote>` +
      (p.companyId
        ? `<p style="margin:0"><a href="${p.baseUrl}/companies/${p.companyId}">Open the record →</a></p>`
        : `<p style="margin:0;color:#9ca3af">No matching company — <a href="${p.baseUrl}/companies">search the CRM</a>.</p>`) +
      `</div>`,
    tags: { kind: "reply_alert" },
  }).catch(() => null);
}
