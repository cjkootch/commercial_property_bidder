import { NextRequest } from "next/server";
import { runBuyerProspecting } from "@/lib/pipeline/buyer-prospecting";

// Weekly buyer-prospecting autopilot (Vercel cron; see vercel.json): after the
// sourcing feeds land Monday's leads, pick the best fresh uncampaigned one and
// build the ~30-company offer list (coverage + commercial signal + found
// email). Emails actually SEND only when PROSPECTING_AUTOSEND=1 — setting that
// env var is the standing operator approval; otherwise offers queue for review.
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
  const summary = await runBuyerProspecting({
    propertyId: sp.get("propertyId") ?? undefined,
    want: Number.isFinite(want) && want > 0 ? want : undefined,
  });
  return Response.json(summary);
}
