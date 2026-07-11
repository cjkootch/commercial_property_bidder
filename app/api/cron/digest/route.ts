import { NextRequest } from "next/server";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  buyer,
  buyerOutreach,
  chatMessage,
  leadUnlock,
  property,
  residentialUnlock,
} from "@/lib/db/schema";
import { sendEmail } from "@/lib/integrations/resend";

// Daily operator digest (audit gap: the operator had no single number to
// watch — funnel state lived in ad-hoc queries). One email each morning:
// what moved in the last 24h and what's hot. Instant events (replies, chats,
// sales, signups) already alert in real time; this is the rollup.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const to = process.env.ALERT_EMAIL;
  if (!to) return Response.json({ skipped: "ALERT_EMAIL not set" });

  const since = new Date(Date.now() - 24 * 3600_000);

  const [outreach] = await db
    .select({
      sent: sql<number>`count(*) filter (where ${buyerOutreach.sent_at} >= ${since})`,
      opened: sql<number>`count(*) filter (where ${buyerOutreach.opened_at} >= ${since})`,
      clicked: sql<number>`count(*) filter (where ${buyerOutreach.clicked_at} >= ${since})`,
      nudged: sql<number>`count(*) filter (where ${buyerOutreach.nudged_at} >= ${since})`,
    })
    .from(buyerOutreach)
    .where(eq(buyerOutreach.status, "sent"));

  const [counts] = await db
    .select({
      newLeads: sql<number>`(select count(*) from ${property} where ${property.created_at} >= ${since} and ${property.archived_at} is null)`,
      newBuyers: sql<number>`(select count(*) from ${buyer} where ${buyer.created_at} >= ${since})`,
      unlocks: sql<number>`(select count(*) from ${leadUnlock} where ${leadUnlock.created_at} >= ${since})`,
      resSales: sql<number>`(select count(*) from ${residentialUnlock} where ${residentialUnlock.created_at} >= ${since})`,
      chats: sql<number>`(select count(*) from ${chatMessage} where ${chatMessage.created_at} >= ${since} and ${chatMessage.sender} = 'buyer')`,
    })
    .from(sql`(select 1) as one`);

  // The hot list: clicked in the last 24h, not yet converted.
  const hot = await db
    .select({
      company: buyerOutreach.company_name,
      city: buyerOutreach.office_city,
      clicks: buyerOutreach.click_count,
    })
    .from(buyerOutreach)
    .where(and(eq(buyerOutreach.status, "sent"), isNotNull(buyerOutreach.clicked_at), gte(buyerOutreach.clicked_at, since)))
    .orderBy(sql`${buyerOutreach.click_count} desc`)
    .limit(5);

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const row = (k: string, v: number | string) =>
    `<tr><td style="padding:2px 12px 2px 0;color:#555">${k}</td><td style="padding:2px 0"><strong>${v}</strong></td></tr>`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">
    <p style="margin:0 0 10px"><strong>Greenkeep — last 24 hours</strong></p>
    <table style="border-collapse:collapse">
      ${row("Offers sent", Number(outreach.sent))}
      ${row("Opens", Number(outreach.opened))}
      ${row("Clicks", Number(outreach.clicked))}
      ${row("Nudges sent", Number(outreach.nudged))}
      ${row("New leads sourced", Number(counts.newLeads))}
      ${row("New buyer accounts", Number(counts.newBuyers))}
      ${row("Lead unlocks", Number(counts.unlocks))}
      ${row("Residential sales", Number(counts.resSales))}
      ${row("Buyer chat messages", Number(counts.chats))}
    </table>
    ${hot.length ? `<p style="margin:12px 0 4px"><strong>Hot (clicked in the last 24h):</strong></p><ul style="margin:0;padding-left:18px">${hot.map((h) => `<li>${esc(h.company)}${h.city ? ` (${esc(h.city)})` : ""} — ${h.clicks} clicks</li>`).join("")}</ul>` : ""}
  </div>`;

  await sendEmail({
    to,
    subject: `Daily digest: ${outreach.sent} sent · ${outreach.clicked} clicks · ${counts.newBuyers} signups · ${Number(counts.unlocks) + Number(counts.resSales)} sales`,
    html,
    tags: { kind: "operator_digest" },
  });
  return Response.json({ ok: true });
}
