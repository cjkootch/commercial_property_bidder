import { NextRequest } from "next/server";
import { runOrlandoDistressSourcing } from "@/lib/pipeline/orlando-distress";

// Weekly Orlando distress autopilot (Vercel cron; see vercel.json): pull
// upcoming tax-deed (orange.realtaxdeed.com) + mortgage-foreclosure
// (orange.realforeclose.com) auction parcels, size the teaser, and add them as
// (TAX <case#>) distress leads. Auth: Vercel sends `Authorization: Bearer
// ${CRON_SECRET}`. Pass ?apply=0 to characterize only.
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
  const summary = await runOrlandoDistressSourcing({
    want: num("want", 8),
    maxDates: num("maxDates", 3),
    apply: sp.get("apply") !== "0",
  });
  return Response.json(summary);
}
