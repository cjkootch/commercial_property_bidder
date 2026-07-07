import { NextRequest } from "next/server";
import { runPermitSourcing } from "@/lib/pipeline/permits";

// Weekly permit-lead autopilot (Vercel cron; see vercel.json): ingest new
// big-ticket TABS registrations, size the marketplace teaser, and alert
// opted-in buyers. Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const num = (k: string, d: number) => {
    const v = Number(sp.get(k));
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  const summary = await runPermitSourcing({
    want: num("want", 5),
    minCost: num("minCost", 500_000),
    sinceDays: num("sinceDays", 14),
  });
  return Response.json(summary);
}
