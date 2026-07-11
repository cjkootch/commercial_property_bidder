import { NextRequest } from "next/server";
import { sendSms } from "@/lib/integrations/twilio";

// Operator smoke test for the Twilio pipeline: sends one SMS to ?to= and
// returns the SID. CRON_SECRET-gated like every /api/cron route (middleware
// public prefix + bearer check). Also the fastest way to verify a new
// number/campaign after carrier registration changes.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const to = req.nextUrl.searchParams.get("to") ?? "";
  const body =
    req.nextUrl.searchParams.get("body") ??
    "Greenkeep SMS smoke test — the pipeline is live. Reply to test inbound.";
  const res = await sendSms({ to, body, kind: "smoke_test" });
  return Response.json(res, { status: res.ok ? 200 : 400 });
}
