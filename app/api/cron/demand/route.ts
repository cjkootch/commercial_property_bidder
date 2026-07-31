import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { usageCounter } from "@/lib/db/schema";
import { guarded } from "@/lib/cron-guard";
import { runBuyerProspecting } from "@/lib/pipeline/buyer-prospecting";
import { maybeLowVolumeAlert } from "@/lib/pipeline/low-volume";
import { TRADES, rotateForSlot, type Trade } from "@/lib/leads/trades";

// The autonomous daily demand engine (quality-plan item #1): reach and
// frequency as software, not sessions. Hourly through the send window on
// business days; each invocation rotates through the trade registry,
// auto-picks the best fresh uncampaigned lead per trade, and sends — under a
// global daily email cap.
//
// Hourly since 2026-07-31, up from three invocations a day. Not a volume
// increase: DAILY_CAP still bounds the day at 90 through the shared
// usage_counter, and the engine was delivering ~26. The runs were being
// TRUNCATED. Each invocation is configured for three leads but was landing one
// or two, because a single run walks up to want*3 candidates with a fetch, a
// geocode and a scrape apiece and can eat the whole 240s budget before the
// second lead starts. Time is the binding constraint and it cannot be relaxed
// (maxDuration is 300), so the fix is more invocations rather than longer
// ones: each arrives with a fresh budget. The visible symptom was 686 of 780
// sourced properties never campaigned while the few that were got hammered —
// 30 offers on a roofing lead that caps at 3 buyers.
//
// Send authority: deploying this route IS the standing approval (spec §9's
// env-var pattern, made explicit here after the operator's 2026-07-11
// directive that the machine run the growth plan itself). Kill switch:
// DEMAND_AUTOPILOT=0 turns every run into a dry run. Junk protection is the
// LEARNED blocklist: every operator exclude= on a live send persists as a
// prospect_company blocked verdict, which every future run honors.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 45 → 90 (2026-07-16 "double the trickle" directive): deliverability and
// tone are proven (79% delivery, ~20-26% reply, zero STOPs) and the funnel
// needs visitor volume — the demand engine is the spigot that feeds both
// channels. Still env-tunable.
const DAILY_CAP = () => {
  const n = Number(process.env.DEMAND_DAILY_CAP);
  return Number.isFinite(n) && n > 0 ? n : 90;
};
const RUNS_PER_INVOCATION = 3;
const TIME_BUDGET_MS = 240_000; // leave headroom under maxDuration

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Sends recorded today (shared across the day's invocations). */
async function sentToday(): Promise<number> {
  const [row] = await db
    .select({ count: usageCounter.count })
    .from(usageCounter)
    .where(
      sql`${usageCounter.key} = ${"demand_sent:" + dayKey()} and ${usageCounter.window_start} = ${new Date(dayKey())}`
    );
  return row?.count ?? 0;
}

async function recordSent(n: number): Promise<void> {
  if (!n) return;
  await db
    .insert(usageCounter)
    .values({ key: `demand_sent:${dayKey()}`, window_start: new Date(dayKey()), count: n })
    .onConflictDoUpdate({
      target: [usageCounter.key, usageCounter.window_start],
      set: { count: sql`${usageCounter.count} + ${n}` },
    });
}

export async function GET(req: NextRequest) {
  return guarded("demand", async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    const off = process.env.DEMAND_AUTOPILOT === "0";
    const started = Date.now();

    const cap = DAILY_CAP();
    let used = await sentToday();
    const results: Array<{ trade: Trade; lead: string | null; sent: number }> = [];

    // Rotate the trade order so every trade gets first pick over the week —
    // the same stateless-rotation trick as the feed rotor. The slot must
    // divide the gap between invocations; see ROTATION_SLOT_MS, which went
    // hourly with this schedule. Tested in lib/leads/rotation.test.ts.
    const rotated = rotateForSlot(Object.keys(TRADES) as Trade[], Date.now());

    let ran = 0;
    let truncated = false;
    const deadlineAt = started + TIME_BUDGET_MS;
    for (const trade of rotated) {
      if (ran >= RUNS_PER_INVOCATION) break;
      if (Date.now() > deadlineAt) break;
      if (used >= cap) break;

      const summary = await runBuyerProspecting({
        trade,
        // Leave headroom so a single run can't blow the daily cap.
        want: Math.min(30, cap - used),
        send: off ? undefined : true,
        dryRun: off ? true : undefined,
        // Hand the budget DOWN. Checking it only between runs cannot stop a
        // single run from overrunning, and one run walks up to want*3
        // candidates with a fetch, a geocode and a scrape apiece.
        deadlineAt,
      });
      if (summary.truncated) truncated = true;
      // No fresh uncampaigned lead for this trade — try the next, free.
      if (!summary.lead) continue;
      ran++;
      used += summary.sent;
      await recordSent(summary.sent);
      results.push({ trade, lead: summary.lead, sent: summary.sent });
    }

    // After the day's last run (20:07 UTC), a starved day pages the operator
    // once — the launch-week 45→45→25→18→0 decay ran green the whole way down.
    await maybeLowVolumeAlert({
      engine: "commercial-demand",
      sent: used,
      cap,
      lastRunHourUtc: 20,
      enabled: !off,
      hint: "Usual suspects: fresh-lead shelf empty (sourcing), discovery pool exhausted or email-less, or scrape failures — read this run's JSON log.",
    });

    return Response.json({
      autopilot: !off,
      dailyCap: cap,
      sentToday: used,
      // Visible in the cron log: a run that stopped on its budget did NOT
      // cover the shelf, and a thin day caused by truncation needs a different
      // response than a thin day caused by no inventory.
      truncated,
      elapsedMs: Date.now() - started,
      runs: results,
    });
  });
}
