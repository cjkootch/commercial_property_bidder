import { NextRequest } from "next/server";
import { buildLeadRows, leadsToCsv, markLeadsExported } from "@/lib/leads/package";

// CSV download of the sellable-lead package (operator-only via middleware).
// Downloading with scope=unexported STAMPS the included leads as exported
// (sold once — they leave the pool); scope=all re-generates without stamping.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const scope = sp.get("scope") === "all" ? "all" : "unexported";
  const buyer = sp.get("buyer")?.trim() || null;

  const rows = await buildLeadRows(scope);
  if (scope === "unexported") {
    await markLeadsExported(rows.map((r) => r.property_id), buyer);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(leadsToCsv(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="greenkeep-leads-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
