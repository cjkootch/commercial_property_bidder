import { NextRequest } from "next/server";
import { runTaxSaleSourcing } from "@/lib/pipeline/taxsales";

// Weekly tax-sale (distressed property) autopilot (Vercel cron; see
// vercel.json): pull the county tax-sale pipeline from the public LGBS sale
// list and add commercial/multifamily/vacant-land parcels as sourced leads.
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
  const summary = await runTaxSaleSourcing({
    want: num("want", 10),
    minValue: num("minValue", 100_000),
    market: sp.get("market") ?? undefined,
  });
  return Response.json(summary);
}
