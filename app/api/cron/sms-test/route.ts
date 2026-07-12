import { NextRequest } from "next/server";
import { sendSms } from "@/lib/integrations/twilio";
import { draftSmsReply } from "@/lib/integrations/claude";

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
  // ?sid=SM… → fetch that message from Twilio and return its routing facts
  // (which pool number sent it, exact error). The fastest way to debug
  // Messaging Service / A2P misconfiguration without console access.
  const sid = req.nextUrl.searchParams.get("sid") ?? "";
  if (sid) {
    const acct = process.env.TWILIO_ACCOUNT_SID ?? "";
    const token = process.env.TWILIO_AUTH_TOKEN ?? "";
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${acct}/Messages/${encodeURIComponent(sid)}.json`,
      { headers: { Authorization: `Basic ${Buffer.from(`${acct}:${token}`).toString("base64")}` } }
    );
    const data = (await res.json()) as Record<string, unknown>;
    return Response.json({
      sid: data.sid ?? null,
      from: data.from ?? null,
      to: data.to ?? null,
      status: data.status ?? null,
      error_code: data.error_code ?? null,
      error_message: data.error_message ?? null,
      messaging_service_sid: data.messaging_service_sid ?? null,
    });
  }

  const to = req.nextUrl.searchParams.get("to") ?? "";
  // No target → config probe: which secrets can THIS deployment see? (Presence
  // only, never values — the fastest way to catch an env var that didn't make
  // it to production.)
  if (!to) {
    // ?ai=1 additionally exercises the real Claude call the auto-reply uses,
    // so billing/key problems surface here instead of in a prospect thread.
    let ai: string | null = null;
    if (req.nextUrl.searchParams.get("ai") === "1") {
      const draft = await draftSmsReply({
        companyName: "Probe Test Co",
        city: "Houston",
        trade: "landscaping",
        claimUrl: null,
        thread: [
          { direction: "out", body: "Hi, is this Probe Test Co in Houston?\n\nThanks,\n-Cole" },
          { direction: "in", body: "Yes. Who is this?" },
        ],
      });
      ai = draft ?? "FAILED (see function logs)";
    }
    return Response.json({
      ai_probe: ai,
      twilio: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM),
      messaging_service: !!process.env.TWILIO_MESSAGING_SERVICE_SID,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      sms_autopilot: process.env.SMS_AUTOPILOT !== "0",
      sms_ai_autoreply: process.env.SMS_AI_AUTOREPLY !== "0",
      app_url: process.env.NEXT_PUBLIC_APP_URL ?? null,
    });
  }
  const body =
    req.nextUrl.searchParams.get("body") ??
    "Greenkeep SMS smoke test — the pipeline is live. Reply to test inbound.";
  const res = await sendSms({ to, body, kind: "smoke_test" });
  return Response.json(res, { status: res.ok ? 200 : 400 });
}
