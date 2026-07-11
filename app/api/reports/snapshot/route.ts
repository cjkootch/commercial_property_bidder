import { NextRequest } from "next/server";
import { getReportData, snapshotMarkdown } from "@/lib/reports/data";

// Machine-readable twin of /reports, gated by CRON_SECRET — lets a working
// session (Claude) pull the EXACT numbers the operator is looking at instead
// of re-deriving them with ad-hoc queries. Same data module as the page.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const parsed = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(parsed) && parsed >= 1 && parsed <= 365 ? Math.floor(parsed) : 28;
  const data = await getReportData(days);
  return Response.json({ data, markdown: snapshotMarkdown(data) });
}
