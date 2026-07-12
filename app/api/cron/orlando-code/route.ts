import { NextRequest } from "next/server";
import { runOrlandoCodeSourcing } from "@/lib/pipeline/orlando-code";

// Weekly Orlando code-enforcement autopilot (Vercel cron; see vercel.json):
// ingest fresh Open nuisance cases (overgrown Lot / green Pool / Tree), size
// the teaser, and add them to the shelf as (CODE …) violation leads. Auth:
// Vercel sends `Authorization: Bearer ${CRON_SECRET}`. Pass ?apply=0 to
// characterize only.
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
  const summary = await runOrlandoCodeSourcing({
    want: num("want", 8),
    sinceDays: num("sinceDays", 14),
    apply: sp.get("apply") !== "0",
  });
  return Response.json(summary);
}
