import { NextRequest } from "next/server";
import { runNudges } from "@/lib/pipeline/nudges";

// Daily 48h-nudge cron: one follow-up to companies that opened/clicked an
// offer but never claimed, while the lead is still open. Dry-run by default;
// the vercel.json schedule passes ?apply=1 (each row is nudged at most once,
// ever, so the daily cadence can't compound into spam).
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const limit = Number(sp.get("limit"));
  const summary = await runNudges({
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    apply: sp.get("apply") === "1",
  });
  return Response.json(summary);
}
