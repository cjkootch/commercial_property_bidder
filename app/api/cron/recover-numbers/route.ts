import { NextRequest } from "next/server";
import { recoverBouncedNumbers } from "@/lib/sms/recover";

// Bounce-driven number recovery (Vercel cron; see vercel.json). Finds prospect
// companies whose most-recent opener carrier-rejected (Twilio failed/
// undelivered), sources a better mobile (Apollo mobile reveal, then website
// scrape), and swaps it in — resetting the line-type cache so the new number
// re-screens before it's texted. Runs before the weekday send window so a
// number that bounced yesterday can re-enter today's queue.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. `?apply=0`
// characterizes only (no DB writes, no attempt marks). `?limit=N` bounds how
// many bounced companies to work per run (default 50).
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const n = Number(sp.get("limit"));
  const limit = Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 50;
  const summary = await recoverBouncedNumbers({ apply: sp.get("apply") !== "0", limit });
  return Response.json(summary);
}
