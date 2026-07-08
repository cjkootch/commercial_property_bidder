import { NextRequest } from "next/server";
import { runRfpSourcing } from "@/lib/pipeline/rfps";

// Weekly public-bid autopilot (Vercel cron; see vercel.json): poll the
// Houston-area Bonfire procurement portals for open grounds/landscaping
// solicitations and add them as public-bid leads. Expiry (archiving leads
// whose deadline passed) runs in the DAILY pipeline cron.
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
  const summary = await runRfpSourcing({ want: num("want", 10) });
  return Response.json(summary);
}
