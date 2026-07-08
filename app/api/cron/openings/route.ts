import { NextRequest } from "next/server";
import { runOpeningSourcing } from "@/lib/pipeline/openings";

// Weekly new-business-opening autopilot (Vercel cron; see vercel.json): pull
// fresh sales-tax registrations at corridor addresses, keep the ones landing
// on real commercial parcels with grass, and add them as sourced properties.
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
  const summary = await runOpeningSourcing({
    want: num("want", 5),
    sinceDays: num("sinceDays", 30),
  });
  return Response.json(summary);
}
