import { NextRequest } from "next/server";
import { buildLeadRows, leadsToCsv, markLeadsExported } from "@/lib/leads/package";

// CSV download of the sellable-lead package (operator-only via middleware).
//
// Stamping a lead as exported CLOSES it marketplace-wide (every trade), so it
// must never happen on a GET — a link prefetcher, Slack/iMessage unfurl, or
// browser preload of a bookmarked URL would silently destroy sellable
// inventory. Therefore:
//   - POST  scope=unexported  → builds the package AND stamps it sold (the
//     operator's "Download CSV" button posts this form).
//   - GET   (any scope)       → read-only preview/re-download; NEVER stamps.
export const dynamic = "force-dynamic";

function csvResponse(csv: string): Response {
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="greenkeep-leads-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Destructive path: build + stamp the unexported package (or re-export all). */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const scope = form?.get("scope") === "all" ? "all" : "unexported";
  const buyer = (form?.get("buyer") as string | null)?.trim() || null;

  const rows = await buildLeadRows(scope);
  if (scope === "unexported") {
    await markLeadsExported(rows.map((r) => r.property_id), buyer);
  }
  return csvResponse(leadsToCsv(rows));
}

/** Read-only path: preview/re-download WITHOUT ever stamping. Safe for
 *  prefetch/preload — a GET can no longer close inventory. */
export async function GET(req: NextRequest) {
  // scope=unexported is honored as a *view* here (what would be sold), but the
  // stamping only happens on POST, so this is non-destructive regardless.
  const scope = req.nextUrl.searchParams.get("scope") === "all" ? "all" : "unexported";
  const rows = await buildLeadRows(scope);
  return csvResponse(leadsToCsv(rows));
}
