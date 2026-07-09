import { NextRequest } from "next/server";
import { runEmailEnrichment } from "@/lib/pipeline/enrich-emails";

// Email enrichment cron: find business emails (via Apollo) for the qualified
// no-email pool so they enter the normal compliant campaign pipeline.
// Dry-run by default; ?apply=1 saves; ?limit=N bounds Apollo credit spend.
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
  const summary = await runEmailEnrichment({
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : undefined,
    apply: sp.get("apply") === "1",
    debug: sp.get("debug") === "1",
  });
  return Response.json(summary);
}
