import { NextRequest } from "next/server";
import { runViolationSourcing } from "@/lib/pipeline/violations";

// Weekly grounds-violation autopilot (Vercel cron; see vercel.json): pull the
// Houston 311 nightly extract, keep open weeds/overgrowth citations on
// commercial/multifamily parcels, and add them as sourced properties.
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`.
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
  const summary = await runViolationSourcing({
    want: num("want", 10),
    sinceDays: num("sinceDays", 14),
  });
  return Response.json(summary);
}
