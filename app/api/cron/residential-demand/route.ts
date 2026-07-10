import { NextRequest } from "next/server";
import { runResidentialDemandGen } from "@/lib/pipeline/residential-demand";
import { asTrade } from "@/lib/leads/trades";

// Residential demand-gen: pitch a published package to home-service companies
// near its geography. OPERATOR-TRIGGERED ONLY — deliberately absent from
// vercel.json; every wave is a human decision. DRY RUN unless ?send=1
// (per-run approval; the caller already holds CRON_SECRET).
// Params: ?packageId= (required), ?trade=, ?want=, ?exclude=a,b, ?send=1
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const packageId = sp.get("packageId");
  if (!packageId) return new Response("packageId required", { status: 400 });
  const want = Number(sp.get("want"));
  const sendOnce = sp.get("send") === "1";
  const summary = await runResidentialDemandGen({
    packageId,
    trade: asTrade(sp.get("trade")),
    want: Number.isFinite(want) && want > 0 ? want : undefined,
    send: sendOnce,
    dryRun: !sendOnce,
    excludeKeys: (sp.get("exclude") ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  });
  return Response.json(summary);
}
