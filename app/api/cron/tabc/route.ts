import { NextRequest } from "next/server";
import { runTabcSourcing } from "@/lib/pipeline/tabc";

// Weekly TABC pending-license autopilot (Vercel cron; see vercel.json): pull
// pending original alcohol-license applications (Harris County) and add the
// venues on commercial parcels as sourced leads — the earliest opening signal.
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
  const summary = await runTabcSourcing({
    want: num("want", 10),
    sinceDays: num("sinceDays", 120),
  });
  return Response.json(summary);
}
