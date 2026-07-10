import { NextRequest } from "next/server";
import { runResidentialSourcing } from "@/lib/pipeline/residential-sourcing";
import { runResidentialPackaging } from "@/lib/pipeline/residential-packages";

// Weekly residential autopilot (Vercel cron; see vercel.json): pull fresh
// recently-sold single-family homes from the county deed layer, then bundle
// every unpackaged lead into DRAFT packages priced by the economics engine.
// Drafts wait for the operator's publish click — nothing goes on sale
// unreviewed. ?source=0 or ?package=0 skip a phase; ?want caps sourcing.
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const want = Number(sp.get("want"));
  const sourcing =
    sp.get("source") === "0"
      ? null
      : await runResidentialSourcing({
          want: Number.isFinite(want) && want > 0 ? want : undefined,
        });
  const packaging = sp.get("package") === "0" ? null : await runResidentialPackaging();
  return Response.json({ sourcing, packaging });
}
