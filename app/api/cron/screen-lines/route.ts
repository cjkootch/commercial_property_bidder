import { NextRequest } from "next/server";
import { screenUnscreenedLines } from "@/lib/sms/screen";

// Line-type backfill: run Twilio Lookup v2 (line_type_intelligence) over
// never-screened, phone-bearing prospect companies and cache the verdict on
// prospect_company.line_type. The text queue then skips true landlines up
// front (mobile + VoIP still text). One-time cost ~$0.008/number, cached
// forever; new numbers screen just-in-time in /api/cron/sms-queue.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. `?limit=N` caps
// how many to screen per invocation (default 200).
//
// Runs DAILY, not weekly (changed 2026-07-31). It was weekly when its only job
// was a one-time backfill of never-screened numbers; those are also screened
// just-in-time by /api/cron/sms-queue, so a slow cadence cost nothing. That
// stopped being true when "unknown" became a disqualifying verdict: JIT
// screening short-circuits on any non-null cached value, so a stale "unknown"
// is a permanent no-text sentence that ONLY this route can lift. On the day of
// the change 620 companies were eligible (216 never screened, 404 carrying an
// unknown older than the re-check window) — three weeks of drain at the old
// weekly/300, against a textable audience with roughly twelve days of runway.
//
// Cost is bounded and small: ~$0.008/lookup, so a full 400 is ~$3.20. That is
// the backlog price, paid a few times. Steady state is only the newly-added
// plus the newly-stale — on current numbers ~30/day, about a quarter each.
// Not idempotent in the free sense: re-running DOES re-reach stale unknowns,
// which is the point, and the staleness window is what keeps it from looping.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const n = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 200;
  const summary = await screenUnscreenedLines(limit);
  return Response.json(summary);
}
