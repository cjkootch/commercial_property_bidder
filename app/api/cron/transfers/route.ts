import { NextRequest } from "next/server";
import { runTransferSourcing } from "@/lib/pipeline/transfers";

// Weekly ownership-transfer autopilot (Vercel cron; see vercel.json): pull
// recently-sold commercial parcels from the county deed feed, grass-screen
// them, and add the qualified ones as sourced properties. Auth: Vercel sends
// `Authorization: Bearer ${CRON_SECRET}`.
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
  const summary = await runTransferSourcing({
    want: num("want", 5),
    minMarketValue: num("minMarketValue", 400_000),
    sinceMonths: num("sinceMonths", 12),
  });
  return Response.json(summary);
}
