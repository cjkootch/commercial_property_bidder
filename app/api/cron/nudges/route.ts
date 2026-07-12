import { NextRequest } from "next/server";
import { guarded } from "@/lib/cron-guard";
import { runNudges } from "@/lib/pipeline/nudges";
import { runOutcomeChecks } from "@/lib/pipeline/outcome-check";

// Daily follow-up cron, two passes on one schedule:
//  - 48h nudge: companies that opened/clicked an offer but never claimed,
//    while the lead is still open.
//  - day-7 outcome check: buyers who unlocked a sheet a week ago — did the
//    contact pan out? (Their reply IS the product feedback loop.)
// Both dry-run by default; the vercel.json schedule passes ?apply=1, and each
// row/unlock is contacted at most once EVER so the daily cadence can't
// compound into spam.
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  return guarded("nudges", async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    const sp = req.nextUrl.searchParams;
    const limit = Number(sp.get("limit"));
    const apply = sp.get("apply") === "1";
    const summary = await runNudges({
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      apply,
    });
    const outcomes = await runOutcomeChecks({ apply });
    return Response.json({ nudges: summary, outcomes });
  });
}
