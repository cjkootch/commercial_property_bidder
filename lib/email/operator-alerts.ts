// Operator alerts for the events that must never sit unseen: money arriving
// and buyers arriving. Replies and chats already alert (reply-alert.ts,
// notifyOperatorOfChat); these fill the audit's gap — before this, a first
// SALE would have fired no notification at all. Everything here is
// best-effort: an alert failure must never break a checkout or a signup.

import { sendEmail } from "../integrations/resend";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function alertOperator(subject: string, lines: string[]): Promise<void> {
  const to = process.env.ALERT_EMAIL;
  if (!to) {
    console.error(`operator alert dropped (ALERT_EMAIL not set): ${subject}`);
    return;
  }
  try {
    await sendEmail({
      to,
      subject,
      html: `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6">${lines
        .map((l) => `<p style="margin:0 0 6px">${esc(l)}</p>`)
        .join("")}</div>`,
      tags: { kind: "operator_alert" },
    });
  } catch (e) {
    console.error("operator alert failed:", e);
  }
}

/** Money arrived (checkout settled or subscription invoice paid). Fires on
 *  every settled payment — including ones later credited back — because the
 *  operator wants to know money moved either way. */
export async function alertOperatorOfSale(p: {
  what: string;
  amountCents: number | null;
  buyerEmail?: string | null;
  detail?: string | null;
}): Promise<void> {
  const usd = p.amountCents != null ? `$${(p.amountCents / 100).toFixed(2)}` : "$?";
  await alertOperator(`💰 ${usd} — ${p.what}`, [
    `Payment settled: ${usd} — ${p.what}`,
    p.buyerEmail ? `Buyer: ${p.buyerEmail}` : "",
    p.detail ?? "",
  ].filter(Boolean));
}

/** An outreach engine finished its day far under cap with every run "green"
 *  — the 2026-07-17 failure mode (sends decayed to zero over a week of
 *  healthy-looking cron runs). Volume is the signal; success logs are not. */
export async function alertOperatorOfLowVolume(p: {
  engine: string;
  sent: number;
  cap: number;
  hint: string;
}): Promise<void> {
  await alertOperator(`📉 ${p.engine}: ${p.sent}/${p.cap} sent today`, [
    `The ${p.engine} engine finished its last run of the day at ${p.sent} of ${p.cap} — no run failed, but the volume starved.`,
    p.hint,
  ]);
}

/** A new buyer account appeared (claim flow or public signup). */
export async function alertOperatorOfSignup(p: {
  company: string;
  email: string;
  trade: string;
  city?: string | null;
  via: "claim" | "signup";
}): Promise<void> {
  await alertOperator(`🆕 Buyer signup: ${p.company}`, [
    `${p.company} created a profile (${p.via === "claim" ? "from a claim link" : "public signup"}).`,
    `Trade: ${p.trade}${p.city ? ` · Office: ${p.city}` : ""}`,
    `Email: ${p.email}`,
  ]);
}
