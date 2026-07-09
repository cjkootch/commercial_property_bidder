import { NextRequest } from "next/server";
import { runRenewals } from "@/lib/pipeline/renewals";

// Weekly renewal-annuity cron (vercel.json): reopen leads at their contract
// anniversary (~11 months after their spots sold) with a fresh sale cycle,
// and alert last year's buyers that the re-bid window is opening.
// Send authority mirrors prospecting: RENEWALS_AUTORUN=1 is standing
// approval for scheduled runs; ?apply=1 is per-run operator approval;
// neither = dry run (unattended firings have zero side effects).
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const applyOnce = req.nextUrl.searchParams.get("apply") === "1";
  const standing = process.env.RENEWALS_AUTORUN === "1" || process.env.RENEWALS_AUTORUN === "true";
  const summary = await runRenewals({ apply: applyOnce || standing });
  return Response.json(summary);
}
