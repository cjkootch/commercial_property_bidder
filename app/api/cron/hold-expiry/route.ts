import { NextRequest } from "next/server";
import { guarded } from "@/lib/cron-guard";
import { runHoldExpiryReminders } from "@/lib/pipeline/hold-expiry";

// The almost-losing moment (see lib/pipeline/hold-expiry.ts): companies whose
// 24h hold on a free lead is about to lapse get ONE reminder with the local
// deadline and a fresh claim link, on their best channel. Hourly inside the
// send window. Kill switch: HOLD_EXPIRY_AUTOPILOT=0.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  return guarded("hold-expiry", async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (process.env.HOLD_EXPIRY_AUTOPILOT === "0") {
      return Response.json({ skipped: "HOLD_EXPIRY_AUTOPILOT=0" });
    }
    const apply = req.nextUrl.searchParams.get("apply") === "1";
    const summary = await runHoldExpiryReminders({ apply });
    return Response.json(summary);
  });
}
