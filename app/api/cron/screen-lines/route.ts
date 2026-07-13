import { NextRequest } from "next/server";
import { screenUnscreenedLines } from "@/lib/sms/screen";

// Line-type backfill: run Twilio Lookup v2 (line_type_intelligence) over
// never-screened, phone-bearing prospect companies and cache the verdict on
// prospect_company.line_type. The text queue then skips true landlines up
// front (mobile + VoIP still text). One-time cost ~$0.008/number, cached
// forever; new numbers screen just-in-time in /api/cron/sms-queue.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. `?limit=N` caps
// how many to screen per invocation (default 200). Idempotent — a screened
// row is skipped by the WHERE, so re-running only reaches fresh numbers.
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
