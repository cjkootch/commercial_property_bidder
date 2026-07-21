import { NextRequest } from "next/server";
import { desc, eq, like, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { guarded } from "@/lib/cron-guard";
import { runResidentialDemandGen } from "@/lib/pipeline/residential-demand";
import { maybeLowVolumeAlert } from "@/lib/pipeline/low-volume";
import { asTrade, type Trade } from "@/lib/leads/trades";

// Residential demand autopilot (2026-07-16 growth directive: "residential
// pipeline will be above and beyond commercial, measured on its own
// metrics"). Two modes:
//  - Operator mode (?packageId=...): the original per-run flow, unchanged —
//    dry run unless ?send=1.
//  - Autopilot (no packageId; the cron): rotates coverage across PUBLISHED
//    packages, always pitching the least-pitched one first, alternating the
//    two homeowner trades (lawn/landscaping and pest). Its own daily send
//    ledger (resi_demand_sent:<day>, cap RESI_DEMAND_DAILY_CAP, default 150 —
//    deliberately additive to the commercial engine's budget, not shared).
//    Kill switch: RESI_DEMAND_AUTOPILOT=0 turns runs into dry runs.
//
// SCHEDULING INVARIANT (vercel.json): this engine fires at :51 and the
// commercial demand engine at :07 — the two cold-email engines must NEVER
// share a minute. Both read a "recently contacted" snapshot (30-day sent
// cooldown + email set) before sending; run them concurrently and each reads
// the snapshot before the other commits, producing cross-engine double-sends
// to the same company. Sequential minutes make the shared cooldown correct.
// (:51 also keeps the waves off the :41 feeds-ingest minute.)
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 90 → 150 (2026-07-16 "bigger launch" directive) with 4 daily waves and 3
// packages per wave — volume AND shelf coverage scale together. Watch the
// /reports residential card's bounce/complaint signals during the ramp; the
// cousin domain has warmed at 25-90/day, and this takes the combined cold
// send to ~240/day.
const DAILY_CAP = () => {
  const n = Number(process.env.RESI_DEMAND_DAILY_CAP);
  return Number.isFinite(n) && n > 0 ? n : 150;
};
const RUNS_PER_INVOCATION = 3;
const TIME_BUDGET_MS = 240_000;
/** The two trades a homeowner package sells to. Rotated by 2h slot so both
 *  get first pick across the week (same stateless trick as the feed rotor). */
const RESI_TRADES: Trade[] = ["landscaping", "pest"];

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function sentToday(): Promise<number> {
  const [row] = await db
    .select({ count: schema.usageCounter.count })
    .from(schema.usageCounter)
    .where(
      sql`${schema.usageCounter.key} = ${"resi_demand_sent:" + dayKey()} and ${schema.usageCounter.window_start} = ${new Date(dayKey())}`
    );
  return row?.count ?? 0;
}

async function recordSent(n: number): Promise<void> {
  if (!n) return;
  await db
    .insert(schema.usageCounter)
    .values({ key: `resi_demand_sent:${dayKey()}`, window_start: new Date(dayKey()), count: n })
    .onConflictDoUpdate({
      target: [schema.usageCounter.key, schema.usageCounter.window_start],
      set: { count: sql`${schema.usageCounter.count} + ${n}` },
    });
}

/** Published packages ordered by how little they've been pitched — coverage
 *  spreads across the shelf instead of hammering one package. */
async function packagesByCoverage(): Promise<string[]> {
  const [pkgs, pitched] = await Promise.all([
    db
      .select({ id: schema.residentialPackage.id })
      .from(schema.residentialPackage)
      .where(eq(schema.residentialPackage.status, "published"))
      .orderBy(desc(schema.residentialPackage.created_at)),
    db
      .select({ claim_url: schema.buyerOutreach.claim_url })
      .from(schema.buyerOutreach)
      .where(like(schema.buyerOutreach.claim_url, "%respkg=%")),
  ]);
  const counts = new Map<string, number>();
  for (const r of pitched) {
    const id = r.claim_url?.match(/respkg=([0-9a-f-]+)/)?.[1];
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  // Newest-first input + stable sort → least-pitched wins, freshest breaks ties.
  return pkgs.map((p) => p.id).sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0));
}

export async function GET(req: NextRequest) {
  return guarded("residential-demand", async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    const sp = req.nextUrl.searchParams;

    // ---- Operator mode: explicit package, per-run send approval.
    const packageId = sp.get("packageId");
    if (packageId) {
      const want = Number(sp.get("want"));
      const sendOnce = sp.get("send") === "1";
      const summary = await runResidentialDemandGen({
        packageId,
        trade: asTrade(sp.get("trade")),
        want: Number.isFinite(want) && want > 0 ? want : undefined,
        send: sendOnce,
        dryRun: !sendOnce,
        excludeKeys: (sp.get("exclude") ?? "")
          .split(",")
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean),
      });
      return Response.json(summary);
    }

    // ---- Autopilot: rotate coverage under the residential ledger.
    const off = process.env.RESI_DEMAND_AUTOPILOT === "0";
    const started = Date.now();
    const cap = DAILY_CAP();
    let used = await sentToday();
    const queue = await packagesByCoverage();
    const offset = Math.floor(Date.now() / (2 * 3600_000)) % RESI_TRADES.length;
    const trades = [...RESI_TRADES.slice(offset), ...RESI_TRADES.slice(0, offset)];

    const results: Array<{ package: string | null; trade: Trade; sent: number }> = [];
    let ran = 0;
    for (const pkgId of queue) {
      if (ran >= RUNS_PER_INVOCATION) break;
      if (Date.now() - started > TIME_BUDGET_MS) break;
      if (used >= cap) break;
      const trade = trades[ran % trades.length];
      const summary = await runResidentialDemandGen({
        packageId: pkgId,
        trade,
        want: Math.min(30, cap - used),
        send: off ? undefined : true,
        dryRun: off ? true : undefined,
      });
      ran++;
      used += summary.sent;
      await recordSent(summary.sent);
      results.push({ package: summary.package, trade, sent: summary.sent });
    }

    // After the day's last wave (20:51 UTC), a starved day pages the operator
    // once — green runs with no volume are the failure mode that hid the
    // launch-day supply collapse.
    await maybeLowVolumeAlert({
      engine: "residential-demand",
      sent: used,
      cap,
      lastRunHourUtc: 20,
      enabled: !off,
      hint: "Usual suspects: discovery finding only no-email companies (Apollo enrichment pending), shelf sold out for the rotation's trades, or scrape/geocode failures — read this run's JSON log.",
    });

    return Response.json({
      autopilot: !off,
      dailyCap: cap,
      sentToday: used,
      publishedPackages: queue.length,
      runs: results,
    });
  });
}
