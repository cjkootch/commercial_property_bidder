import { NextRequest } from "next/server";
import { guarded } from "@/lib/cron-guard";
import { runLongTail } from "@/lib/pipeline/long-tail";

// Weekly long-tail re-engagement (see lib/pipeline/long-tail.ts): quiet
// prospects ≥30 days silent get ONE re-touch with a genuinely NEW lead near
// them — email first, SMS for phone-only — capped at 4 lifetime touches.
// Kill switch: LONG_TAIL_AUTOPILOT=0.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  return guarded("long-tail", async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (process.env.LONG_TAIL_AUTOPILOT === "0") {
      return Response.json({ skipped: "LONG_TAIL_AUTOPILOT=0" });
    }
    const limit = Number(req.nextUrl.searchParams.get("limit")) || 40;
    const summary = await runLongTail(limit);
    return Response.json(summary);
  });
}
