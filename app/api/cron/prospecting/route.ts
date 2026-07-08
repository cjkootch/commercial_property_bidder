import { NextRequest } from "next/server";
import { autosendEnabled, runBuyerProspecting } from "@/lib/pipeline/buyer-prospecting";

// Weekly buyer-prospecting autopilot (Vercel cron; see vercel.json): after the
// sourcing feeds land Monday's leads, pick the best fresh uncampaigned one and
// build the ~30-company offer list (coverage + commercial signal + found
// email). Send authority, in order:
//   - PROSPECTING_AUTOSEND=1 env var: standing approval — scheduled runs send.
//   - ?send=1 on a manual request: per-run approval (the caller already holds
//     CRON_SECRET, so this is operator-only) — queue + send this once.
//   - neither: DRY RUN. Unattended cron firings write nothing and send
//     nothing, so leads and companies aren't burned while automation is off.
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const want = Number(sp.get("want"));
  const sendOnce = sp.get("send") === "1";
  const summary = await runBuyerProspecting({
    propertyId: sp.get("propertyId") ?? undefined,
    want: Number.isFinite(want) && want > 0 ? want : undefined,
    send: sendOnce || undefined,
    dryRun: !sendOnce && !autosendEnabled() ? true : undefined,
  });
  return Response.json(summary);
}
