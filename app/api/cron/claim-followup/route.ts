import { NextRequest } from "next/server";
import { guarded } from "@/lib/cron-guard";
import { runClaimFollowUps } from "@/lib/pipeline/claim-followup";

// The offer-viewed follow-up (see lib/pipeline/claim-followup.ts). Opening the
// claim page is the strongest unconverted signal in the system, and until now
// nothing acted on it — on 2026-07-31 nineteen companies had read the offer and
// been left alone, three of them having read it twice.
//
// Twice daily inside the send window. Once ever per company. Runs in APPLY mode
// only when explicitly asked, so a misfired schedule cannot blast the list.
// Kill switch: CLAIM_FOLLOWUP_AUTOPILOT=0.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  return guarded("claim-followup", async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (process.env.CLAIM_FOLLOWUP_AUTOPILOT === "0") {
      return Response.json({ skipped: "CLAIM_FOLLOWUP_AUTOPILOT=0" });
    }
    // Default DRY. The scheduled entry passes ?apply=1 explicitly, matching
    // hold-expiry — a route that sends by default is one bad deploy away from
    // messaging every warm prospect at once.
    const apply = req.nextUrl.searchParams.get("apply") === "1";
    const summary = await runClaimFollowUps({ apply });
    return Response.json(summary);
  });
}
