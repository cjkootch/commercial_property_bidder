import { NextRequest } from "next/server";
import { runPipeline, CRON_CAPS } from "@/lib/pipeline/runner";
import { expireRfpLeads } from "@/lib/pipeline/rfps";

// Nightly pipeline tick (Vercel cron; see vercel.json). Auth: Vercel sends
// `Authorization: Bearer ${CRON_SECRET}` automatically when the env var is set.
// The runner NEVER sends email — it only fills the /queue for morning approval.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const cap = (key: keyof typeof CRON_CAPS) => {
    const v = Number(sp.get(key));
    return Number.isFinite(v) && v >= 0 ? v : CRON_CAPS[key];
  };

  // Public-bid leads die at their deadline — sweep daily so an expired
  // solicitation never sits on the shelf looking sellable.
  const rfpsExpired = await expireRfpLeads();

  const summary = await runPipeline({
    sourceNew: cap("sourceNew"),
    sourceLookups: cap("sourceLookups"),
    price: cap("price"),
    contacts: cap("contacts"),
  });
  return Response.json({ ...summary, rfpsExpired });
}
