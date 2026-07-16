import { eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  buyer,
  buyerOutreach,
  emailSend,
  leadUnlock,
  outreach,
  postcard,
  property,
  prospectCompany,
  residentialPackage,
  residentialUnlock,
  smsOptOut,
  smsSend,
  usageCounter,
} from "@/lib/db/schema";
import { TEXT_QUEUE_DAILY_CAP } from "@/lib/sms/queue";
import { marketForCoords } from "@/lib/markets";
import { TRADES, asTrade, type Trade } from "@/lib/leads/trades";

// Data layer for /reports — the GA-style operator analytics view. One fetch
// pass over the (still small) engagement tables, aggregated in JS so every
// number on the page and in the snapshot endpoint comes from the SAME code
// path. Revisit with SQL GROUP BYs when row counts make full scans hurt.

export type EngagementBucket = { label: string; sends: number; opens: number; clicks: number };
export type FunnelStage = { label: string; value: number; note?: string };
export type Kpi = {
  key: string;
  label: string;
  value: string;
  /** % change vs the previous equal-length period; null = no baseline. */
  delta: number | null;
  help: string;
};
export type TradeRow = {
  key: string;
  label: string;
  sends: number;
  opens: number;
  clicks: number;
  claims: number;
  signups: number;
};
export type MetroRow = { key: string; label: string; sends: number; opens: number; clicks: number };
export type TimelineEvent = { date: string; text: string };

export type SmsReport = {
  /** Same tile shape as the email KPIs so the page renders them identically. */
  kpis: Kpi[];
  /** The first-touch opener cron (shares its daily cap with manual queue sends). */
  autopilot: { enabled: boolean; aiEnabled: boolean; sentToday: number; cap: number };
};

export type ReportData = {
  days: number;
  generatedAt: string;
  buckets: EngagementBucket[];
  /** true = each bucket is a week, not a day (long ranges). */
  weekly: boolean;
  kpis: Kpi[];
  funnel: FunnelStage[];
  byTrade: TradeRow[];
  byMetro: MetroRow[];
  timeline: TimelineEvent[];
  autopilot: { enabled: boolean; sentToday: number; cap: number };
  sms: SmsReport;
  /** The residential pipeline's OWN funnel (2026-07-16 directive) — its rows
   *  are split out of every commercial aggregate above. */
  residential: {
    pitched: number;
    pitchedPrev: number;
    opened: number;
    clicked: number;
    purchases: number;
    revenueCents: number;
    packagesPublished: number;
    packagesPitched: number;
    autopilot: { enabled: boolean; sentToday: number; cap: number };
  };
};

const DAY_MS = 86_400_000;

// Business days run on Texas wall clock, not UTC.
const chicagoFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function chicagoDay(d: Date): string {
  return chicagoFmt.format(d);
}

function pctDelta(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

export async function getReportData(days: number): Promise<ReportData> {
  const now = Date.now();
  const winStart = now - days * DAY_MS;
  const prevStart = now - 2 * days * DAY_MS;
  const inWin = (t: Date | null | undefined) => !!t && t.getTime() >= winStart;
  const inPrev = (t: Date | null | undefined) =>
    !!t && t.getTime() >= prevStart && t.getTime() < winStart;

  const [boAll, ow, es, companies, buyers, unlocks, resUnlocks, resPkgs, cards, props, counters, sms, smsOptOuts] =
    await Promise.all([
      db
        .select({
          company_key: buyerOutreach.company_key,
          property_id: buyerOutreach.property_id,
          claim_url: buyerOutreach.claim_url,
          sent_at: buyerOutreach.sent_at,
          delivered_at: buyerOutreach.delivered_at,
          opened_at: buyerOutreach.opened_at,
          clicked_at: buyerOutreach.clicked_at,
          nudged_at: buyerOutreach.nudged_at,
          nudge_opened_at: buyerOutreach.nudge_opened_at,
          nudge_clicked_at: buyerOutreach.nudge_clicked_at,
        })
        .from(buyerOutreach)
        .where(isNotNull(buyerOutreach.sent_at)),
      db
        .select({
          sent_at: outreach.sent_at,
          opened_at: outreach.opened_at,
          clicked_at: outreach.clicked_at,
        })
        .from(outreach)
        .where(isNotNull(outreach.sent_at)),
      db
        .select({
          created_at: emailSend.created_at,
          opened_at: emailSend.opened_at,
          clicked_at: emailSend.clicked_at,
        })
        .from(emailSend),
      db
        .select({
          key: prospectCompany.key,
          trade: prospectCompany.trade,
          last_claim_view_at: prospectCompany.last_claim_view_at,
        })
        .from(prospectCompany),
      db.select({ created_at: buyer.created_at, trade: buyer.trade }).from(buyer),
      db
        .select({
          created_at: leadUnlock.created_at,
          kind: leadUnlock.kind,
          trade: leadUnlock.trade,
          price_cents: leadUnlock.price_cents,
        })
        .from(leadUnlock),
      db
        .select({ created_at: residentialUnlock.created_at, price_cents: residentialUnlock.price_cents })
        .from(residentialUnlock),
      db.select({ status: residentialPackage.status }).from(residentialPackage),
      db
        .select({ created_at: postcard.created_at, price_cents: postcard.price_cents, status: postcard.status })
        .from(postcard),
      db.select({ id: property.id, lat: property.lat, lng: property.lng }).from(property),
      // Rate-limit counters share this table — fetch today's demand ledgers.
      db
        .select({ key: usageCounter.key, count: usageCounter.count })
        .from(usageCounter)
        .where(
          inArray(usageCounter.key, [
            `demand_sent:${new Date().toISOString().slice(0, 10)}`,
            `resi_demand_sent:${new Date().toISOString().slice(0, 10)}`,
          ])
        ),
      db
        .select({
          direction: smsSend.direction,
          kind: smsSend.kind,
          phone: smsSend.phone,
          status: smsSend.status,
          created_at: smsSend.created_at,
        })
        .from(smsSend),
      db.select({ created_at: smsOptOut.created_at }).from(smsOptOut),
    ]);

  // Residential pitches ride buyer_outreach but are their OWN funnel — split
  // them out so every commercial aggregate below stays pure.
  const resiPitches = boAll.filter((r) => r.claim_url?.includes("respkg="));
  const bo = boAll.filter((r) => !r.claim_url?.includes("respkg="));

  // --- daily/weekly engagement buckets --------------------------------------
  const weekly = days > 35;
  const dayLabels = Array.from({ length: days }, (_, i) =>
    chicagoDay(new Date(now - (days - 1 - i) * DAY_MS))
  );
  const dayIndex = new Map(dayLabels.map((d, i) => [d, i]));
  const bucketOf = (i: number) => (weekly ? Math.floor(i / 7) : i);
  const bucketCount = weekly ? Math.ceil(days / 7) : days;
  const buckets: EngagementBucket[] = Array.from({ length: bucketCount }, (_, b) => ({
    label: weekly ? `Wk of ${dayLabels[b * 7]}` : dayLabels[b],
    sends: 0,
    opens: 0,
    clicks: 0,
  }));
  const bump = (t: Date | null | undefined, field: "sends" | "opens" | "clicks") => {
    if (!t) return;
    const i = dayIndex.get(chicagoDay(t));
    if (i == null) return;
    buckets[bucketOf(i)][field]++;
  };
  for (const r of bo) {
    bump(r.sent_at, "sends");
    bump(r.nudged_at, "sends"); // follow-up steps are sends too
    bump(r.opened_at, "opens");
    bump(r.nudge_opened_at, "opens");
    bump(r.clicked_at, "clicks");
    bump(r.nudge_clicked_at, "clicks");
  }
  for (const r of ow) {
    bump(r.sent_at, "sends");
    bump(r.opened_at, "opens");
    bump(r.clicked_at, "clicks");
  }
  for (const r of es) {
    bump(r.created_at, "sends");
    bump(r.opened_at, "opens");
    bump(r.clicked_at, "clicks");
  }

  // --- KPI tiles (window vs previous window) --------------------------------
  const sendTimes: (Date | null)[] = [
    ...bo.map((r) => r.sent_at),
    ...bo.map((r) => r.nudged_at),
    ...ow.map((r) => r.sent_at),
    ...es.map((r) => r.created_at),
  ];
  const sendsCur = sendTimes.filter(inWin).length;
  const sendsPrev = sendTimes.filter(inPrev).length;

  // Cohort rates: of messages SENT in the window, how many have opened/clicked.
  type Msg = { sent: Date | null; opened: Date | null; clicked: Date | null };
  const msgs: Msg[] = [
    ...bo.map((r) => ({ sent: r.sent_at, opened: r.opened_at, clicked: r.clicked_at })),
    ...bo
      .filter((r) => r.nudged_at)
      .map((r) => ({ sent: r.nudged_at, opened: r.nudge_opened_at, clicked: r.nudge_clicked_at })),
    ...ow.map((r) => ({ sent: r.sent_at, opened: r.opened_at, clicked: r.clicked_at })),
    ...es.map((r) => ({ sent: r.created_at, opened: r.opened_at, clicked: r.clicked_at })),
  ];
  const rate = (pool: Msg[], f: "opened" | "clicked") =>
    pool.length ? Math.round((pool.filter((m) => m[f]).length / pool.length) * 100) : 0;
  const cohortCur = msgs.filter((m) => inWin(m.sent));
  const cohortPrev = msgs.filter((m) => inPrev(m.sent));

  const claimsCur = companies.filter((c) => inWin(c.last_claim_view_at)).length;
  const claimsPrev = companies.filter((c) => inPrev(c.last_claim_view_at)).length;
  const buyersCur = buyers.filter((b) => inWin(b.created_at)).length;
  const buyersPrev = buyers.filter((b) => inPrev(b.created_at)).length;

  const revenueCentsIn = (test: (t: Date | null | undefined) => boolean) =>
    unlocks.filter((u) => test(u.created_at)).reduce((s, u) => s + u.price_cents, 0) +
    resUnlocks.filter((u) => test(u.created_at)).reduce((s, u) => s + u.price_cents, 0) +
    cards
      .filter((c) => c.status === "created" && test(c.created_at))
      .reduce((s, c) => s + c.price_cents, 0);
  const revCur = revenueCentsIn(inWin);
  const revPrev = revenueCentsIn(inPrev);

  const openRateCur = rate(cohortCur, "opened");
  const openRatePrev = rate(cohortPrev, "opened");
  const clickRateCur = rate(cohortCur, "clicked");
  const clickRatePrev = rate(cohortPrev, "clicked");

  const kpis: Kpi[] = [
    {
      key: "sends",
      label: "Emails sent",
      value: sendsCur.toLocaleString(),
      delta: pctDelta(sendsCur, sendsPrev),
      help: "Campaign offers + follow-ups + owner proposals + one-off sends",
    },
    {
      key: "open_rate",
      label: "Open rate",
      value: `${openRateCur}%`,
      delta: openRatePrev ? openRateCur - openRatePrev : null,
      help: "Of messages sent this period (delta in points)",
    },
    {
      key: "click_rate",
      label: "Click rate",
      value: `${clickRateCur}%`,
      delta: clickRatePrev ? clickRateCur - clickRatePrev : null,
      help: "Of messages sent this period (delta in points)",
    },
    {
      key: "claims",
      label: "Claim-page views",
      value: claimsCur.toLocaleString(),
      delta: pctDelta(claimsCur, claimsPrev),
      help: "Companies that opened their claim page (hottest signal)",
    },
    {
      key: "buyers",
      label: "New buyers",
      value: buyersCur.toLocaleString(),
      delta: pctDelta(buyersCur, buyersPrev),
      help: "Accounts created this period",
    },
    {
      key: "revenue",
      label: "Revenue",
      value: `$${Math.round(revCur / 100).toLocaleString()}`,
      delta: pctDelta(revCur, revPrev),
      help: "Paid unlocks + residential + postcards",
    },
  ];

  // --- funnel (campaign cohort sent this period) -----------------------------
  const cohort = bo.filter((r) => inWin(r.sent_at));
  const cohortKeys = new Set(cohort.map((r) => r.company_key));
  const claimedCompanies = companies.filter(
    (c) => cohortKeys.has(c.key) && inWin(c.last_claim_view_at)
  ).length;
  const funnel: FunnelStage[] = [
    { label: "Offers sent", value: cohort.length },
    { label: "Delivered", value: cohort.filter((r) => r.delivered_at).length },
    {
      label: "Opened",
      value: cohort.filter((r) => r.opened_at || r.nudge_opened_at).length,
    },
    {
      label: "Clicked",
      value: cohort.filter((r) => r.clicked_at || r.nudge_clicked_at).length,
    },
    { label: "Claim page viewed", value: claimedCompanies, note: "companies" },
    { label: "Signed up", value: buyersCur, note: "all sources" },
    {
      label: "Lead unlocked",
      value: unlocks.filter((u) => inWin(u.created_at)).length,
      note: "free + paid",
    },
  ];

  // --- per-trade breakdown (campaign cohort) ---------------------------------
  const tradeByKey = new Map(companies.map((c) => [c.key, asTrade(c.trade)]));
  const tradeRows = new Map<Trade, TradeRow>();
  const tradeRow = (t: Trade) => {
    let row = tradeRows.get(t);
    if (!row) {
      row = { key: t, label: TRADES[t].label, sends: 0, opens: 0, clicks: 0, claims: 0, signups: 0 };
      tradeRows.set(t, row);
    }
    return row;
  };
  for (const r of cohort) {
    const row = tradeRow(tradeByKey.get(r.company_key) ?? "landscaping");
    row.sends++;
    if (r.opened_at || r.nudge_opened_at) row.opens++;
    if (r.clicked_at || r.nudge_clicked_at) row.clicks++;
  }
  for (const c of companies) {
    if (cohortKeys.has(c.key) && inWin(c.last_claim_view_at)) {
      tradeRow(tradeByKey.get(c.key) ?? "landscaping").claims++;
    }
  }
  for (const b of buyers) {
    if (inWin(b.created_at)) tradeRow(asTrade(b.trade)).signups++;
  }
  const byTrade = [...tradeRows.values()].sort((a, b) => b.sends - a.sends);

  // --- per-metro breakdown (campaign cohort, lead coords → market bbox) ------
  const coords = new Map(props.map((p) => [p.id, p]));
  const metroRows = new Map<string, MetroRow>();
  for (const r of cohort) {
    const p = r.property_id ? coords.get(r.property_id) : undefined;
    const m = marketForCoords(p?.lat, p?.lng);
    let row = metroRows.get(m.key);
    if (!row) {
      row = { key: m.key, label: m.label, sends: 0, opens: 0, clicks: 0 };
      metroRows.set(m.key, row);
    }
    row.sends++;
    if (r.opened_at || r.nudge_opened_at) row.opens++;
    if (r.clicked_at || r.nudge_clicked_at) row.clicks++;
  }
  const byMetro = [...metroRows.values()].sort((a, b) => b.sends - a.sends);

  // --- timeline: launch milestones derived from the data (GA "annotations",
  // computed instead of hand-entered — no one has to remember to log them) ----
  const events: TimelineEvent[] = [];
  const firstByTrade = new Map<Trade, number>();
  const firstByMetro = new Map<string, { label: string; t: number }>();
  for (const r of bo) {
    if (!r.sent_at) continue;
    const t = r.sent_at.getTime();
    const trade = tradeByKey.get(r.company_key) ?? "landscaping";
    if (!firstByTrade.has(trade) || t < firstByTrade.get(trade)!) firstByTrade.set(trade, t);
    const p = r.property_id ? coords.get(r.property_id) : undefined;
    const m = marketForCoords(p?.lat, p?.lng);
    const cur = firstByMetro.get(m.key);
    if (!cur || t < cur.t) firstByMetro.set(m.key, { label: m.label, t });
  }
  for (const [trade, t] of firstByTrade) {
    events.push({ date: chicagoDay(new Date(t)), text: `First ${TRADES[trade].label} campaign sent` });
  }
  for (const { label, t } of firstByMetro.values()) {
    events.push({ date: chicagoDay(new Date(t)), text: `First campaign in ${label}` });
  }
  const firstPaid = unlocks
    .filter((u) => u.price_cents > 0)
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())[0];
  if (firstPaid) {
    events.push({ date: chicagoDay(firstPaid.created_at), text: "First paid lead unlock 🎉" });
  }
  events.sort((a, b) => (a.date < b.date ? 1 : -1));
  const timeline = events.slice(0, 10);

  // --- autopilot (demand engine) ---------------------------------------------
  const utcToday = new Date().toISOString().slice(0, 10);
  const sentToday = counters.find((c) => c.key === `demand_sent:${utcToday}`)?.count ?? 0;
  const capEnv = Number(process.env.DEMAND_DAILY_CAP);
  const autopilot = {
    enabled: process.env.DEMAND_AUTOPILOT !== "0",
    sentToday,
    cap: Number.isFinite(capEnv) && capEnv > 0 ? capEnv : 45,
  };

  // --- SMS channel (texts sent/delivered, replies, AI activity, opt-outs) ----
  const smsOut = sms.filter((r) => r.direction === "out");
  const smsIn = sms.filter((r) => r.direction === "in");
  const smsOutCur = smsOut.filter((r) => inWin(r.created_at));
  const smsOutPrev = smsOut.filter((r) => inPrev(r.created_at));
  const smsInCur = smsIn.filter((r) => inWin(r.created_at));
  const smsInPrev = smsIn.filter((r) => inPrev(r.created_at));
  // Delivery rate over SETTLED messages only — a text sent minutes before
  // this render is still "queued"/"sent" and counting it as a miss turns the
  // delta red for no reason.
  const deliveredPct = (pool: typeof smsOut) => {
    const settled = pool.filter((r) => ["delivered", "undelivered", "failed"].includes(r.status));
    return settled.length
      ? Math.round(
          (settled.filter((r) => r.status === "delivered").length / settled.length) * 100
        )
      : 0;
  };
  // Cohort rate like the email KPIs: of numbers we OPENED with in the period
  // (text_queue first touches), how many have replied — ever, so a Friday
  // opener answered Monday still counts for Friday's cohort.
  const replyStats = (test: (t: Date | null | undefined) => boolean) => {
    const opened = new Set(
      smsOut.filter((r) => r.kind === "text_queue" && test(r.created_at)).map((r) => r.phone)
    );
    if (!opened.size) return { rate: 0, cohort: 0 };
    const replied = new Set(smsIn.filter((r) => opened.has(r.phone)).map((r) => r.phone));
    return { rate: Math.round((replied.size / opened.size) * 100), cohort: opened.size };
  };
  const smsDelivCur = deliveredPct(smsOutCur);
  const smsDelivPrev = deliveredPct(smsOutPrev);
  const smsReplyCur = replyStats(inWin);
  const smsReplyPrev = replyStats(inPrev);
  const smsAiCur = smsOutCur.filter((r) => r.kind === "ai_reply").length;
  const smsAiPrev = smsOutPrev.filter((r) => r.kind === "ai_reply").length;
  const smsOptCur = smsOptOuts.filter((o) => inWin(o.created_at)).length;
  const smsOptPrev = smsOptOuts.filter((o) => inPrev(o.created_at)).length;
  const today = chicagoDay(new Date());
  const smsReport: SmsReport = {
    kpis: [
      {
        key: "sms_sends",
        label: "Texts sent",
        value: smsOutCur.length.toLocaleString(),
        delta: pctDelta(smsOutCur.length, smsOutPrev.length),
        help: "All outbound SMS: queue openers, manual replies, AI replies",
      },
      {
        key: "sms_delivery_rate",
        label: "Delivered",
        value: `${smsDelivCur}%`,
        delta: smsOutPrev.length ? smsDelivCur - smsDelivPrev : null,
        help: "Of texts sent this period, confirmed delivered by the carrier (delta in points)",
      },
      {
        key: "sms_replies",
        label: "Replies",
        value: smsInCur.length.toLocaleString(),
        delta: pctDelta(smsInCur.length, smsInPrev.length),
        help: "Inbound texts this period (includes STOPs)",
      },
      {
        key: "sms_reply_rate",
        label: "Reply rate",
        value: `${smsReplyCur.rate}%`,
        // Guard on the previous COHORT existing, not its rate — a genuine
        // 0% → 30% improvement deserves a delta.
        delta: smsReplyPrev.cohort ? smsReplyCur.rate - smsReplyPrev.rate : null,
        help: "Of numbers we opened with this period, % that have replied (delta in points). Young cohorts read low — replies keep landing after the window closes.",
      },
      {
        key: "sms_ai",
        label: "AI replies",
        value: smsAiCur.toLocaleString(),
        delta: pctDelta(smsAiCur, smsAiPrev),
        help: "Conversations the AI answered for you this period",
      },
      {
        key: "sms_optouts",
        label: "Opt-outs",
        value: smsOptCur.toLocaleString(),
        delta: pctDelta(smsOptCur, smsOptPrev),
        help: "STOP replies this period — rising means the opener or targeting needs work",
      },
    ],
    autopilot: {
      enabled: process.env.SMS_AUTOPILOT !== "0",
      aiEnabled: process.env.SMS_AI_AUTOREPLY !== "0",
      sentToday: smsOut.filter(
        (r) =>
          (r.kind === "text_queue" || r.kind === "text_nudge") &&
          chicagoDay(r.created_at) === today
      ).length,
      cap: TEXT_QUEUE_DAILY_CAP(),
    },
  };

  // --- residential: its own funnel, measured on its own numbers -------------
  const resiToday = `resi_demand_sent:${new Date().toISOString().slice(0, 10)}`;
  const resiCap = Number(process.env.RESI_DEMAND_DAILY_CAP) || 90; // mirrors residential-demand route
  const residential = {
    pitched: resiPitches.filter((r) => inWin(r.sent_at)).length,
    pitchedPrev: resiPitches.filter((r) => inPrev(r.sent_at)).length,
    opened: resiPitches.filter((r) => inWin(r.opened_at)).length,
    clicked: resiPitches.filter((r) => inWin(r.clicked_at)).length,
    purchases: resUnlocks.filter((u) => inWin(u.created_at)).length,
    revenueCents: resUnlocks
      .filter((u) => inWin(u.created_at))
      .reduce((a, u) => a + (u.price_cents ?? 0), 0),
    packagesPublished: resPkgs.filter((x) => x.status === "published").length,
    packagesPitched: new Set(
      resiPitches
        .map((r) => r.claim_url?.match(/respkg=([0-9a-f-]+)/)?.[1])
        .filter(Boolean)
    ).size,
    autopilot: {
      enabled: process.env.RESI_DEMAND_AUTOPILOT !== "0",
      sentToday: counters.find((c) => c.key === resiToday)?.count ?? 0,
      cap: resiCap,
    },
  };

  return {
    days,
    generatedAt: new Date().toISOString(),
    buckets,
    weekly,
    kpis,
    funnel,
    byTrade,
    byMetro,
    timeline,
    autopilot,
    sms: smsReport,
    residential,
  };
}

/** Plain-markdown snapshot of the report — the "copy for Claude" payload and
 *  the /api/reports/snapshot body. Same numbers as the page, by construction. */
export function snapshotMarkdown(d: ReportData): string {
  const L: string[] = [];
  L.push(`# Greenkeep report — last ${d.days} days (generated ${d.generatedAt})`);
  L.push("");
  L.push("## KPIs (vs previous period)");
  for (const k of d.kpis) {
    const delta = k.delta == null ? "" : ` (${k.delta > 0 ? "+" : ""}${k.delta}${k.key.endsWith("rate") ? "pt" : "%"})`;
    L.push(`- ${k.label}: ${k.value}${delta}`);
  }
  L.push("");
  L.push("## Funnel (campaign cohort this period)");
  for (const s of d.funnel) L.push(`- ${s.label}: ${s.value}${s.note ? ` (${s.note})` : ""}`);
  L.push("");
  L.push("## By trade (sends / opened / clicked / claim views / signups)");
  for (const t of d.byTrade)
    L.push(`- ${t.label}: ${t.sends} / ${t.opens} / ${t.clicks} / ${t.claims} / ${t.signups}`);
  L.push("");
  L.push("## By metro (sends / opened / clicked)");
  for (const m of d.byMetro) L.push(`- ${m.label}: ${m.sends} / ${m.opens} / ${m.clicks}`);
  L.push("");
  L.push(
    `## Autopilot: ${d.autopilot.enabled ? "ON" : "OFF"} — ${d.autopilot.sentToday}/${d.autopilot.cap} sent today`
  );
  L.push("");
  L.push("## Residential (own funnel)");
  L.push(`- Pitched: ${d.residential.pitched} (prev ${d.residential.pitchedPrev})`);
  L.push(`- Opened: ${d.residential.opened} / Clicked: ${d.residential.clicked}`);
  L.push(
    `- Purchases: ${d.residential.purchases} — $${Math.round(d.residential.revenueCents / 100).toLocaleString()}`
  );
  L.push(
    `- Shelf: ${d.residential.packagesPublished} published, ${d.residential.packagesPitched} pitched at least once`
  );
  L.push(
    `- Autopilot: ${d.residential.autopilot.enabled ? "ON" : "OFF"} — ${d.residential.autopilot.sentToday}/${d.residential.autopilot.cap} sent today`
  );
  L.push("");
  L.push("## SMS (vs previous period)");
  for (const k of d.sms.kpis) {
    const delta = k.delta == null ? "" : ` (${k.delta > 0 ? "+" : ""}${k.delta}${k.key.endsWith("rate") ? "pt" : "%"})`;
    L.push(`- ${k.label}: ${k.value}${delta}`);
  }
  L.push(
    `- Autopilot: openers ${d.sms.autopilot.enabled ? "ON" : "OFF"} / AI replies ${d.sms.autopilot.aiEnabled ? "ON" : "OFF"} — ${d.sms.autopilot.sentToday}/${d.sms.autopilot.cap} queue sends today (openers + nudges)`
  );
  L.push("");
  L.push("## Daily engagement (sends / opens / clicks)");
  for (const b of d.buckets) {
    if (b.sends || b.opens || b.clicks) L.push(`- ${b.label}: ${b.sends} / ${b.opens} / ${b.clicks}`);
  }
  return L.join("\n");
}
