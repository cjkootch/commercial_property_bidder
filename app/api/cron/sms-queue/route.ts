import { NextRequest } from "next/server";
import { guarded } from "@/lib/cron-guard";
import { sendSms } from "@/lib/integrations/twilio";
import { rateLimit } from "@/lib/ratelimit";
import {
  suggestedTexts,
  smsNudgeTargets,
  queueSentToday,
  withinSmsSendWindow,
  TEXT_QUEUE_DAILY_CAP,
} from "@/lib/sms/queue";

// Automated first-touch SMS (the operator's 2026-07-12 standing approval:
// "we need to automate the initial sends... blanket auth"). Sends the
// two-step OPENER to the top of the text queue — the same ranked list, the
// same message, the same caps as the manual tap. Conversations stay human:
// replies land in the inbox with AI drafts, never auto-answered.
//
// Guardrails compiled in, not configurable away:
//  - Daily cap shared with manual sends (TEXT_QUEUE_DAILY_CAP, default 200 —
//    sized for the two-number Messaging Service pool; tune via env)
//  - Business hours on Texas wall clock + weekdays only (withinSmsSendWindow),
//    enforced here regardless of how the cron schedule is edited
//  - Queue eligibility: engaged/phone-only prospects with a live claim link;
//    never texted before, never opted out/blocked/converted
//  - Kill switch: SMS_AUTOPILOT=0 turns every run into a no-op
export const dynamic = "force-dynamic";
export const maxDuration = 300; // up to 60 sequential sends per run

const PER_RUN = () => {
  const n = Number(process.env.SMS_QUEUE_PER_RUN);
  return Number.isFinite(n) && n > 0 ? n : 60;
};

export async function GET(req: NextRequest) {
  return guarded("sms-queue", async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (process.env.SMS_AUTOPILOT === "0") {
      return Response.json({ skipped: "SMS_AUTOPILOT=0" });
    }
    if (!withinSmsSendWindow(new Date())) {
      return Response.json({ skipped: "outside business-hours send window" });
    }

    const cap = TEXT_QUEUE_DAILY_CAP();
    const used = await queueSentToday();
    const budget = Math.min(PER_RUN(), cap - used);
    if (budget <= 0) {
      return Response.json({ skipped: `daily cap reached (${used}/${cap})` });
    }

    // Nudges expire (claim-token life) — when both compete for budget, fresh
    // openers lead but nudges keep a reserved slot (at least one whenever any
    // budget exists) so a full queue can never starve them to death.
    const dueNudges = await smsNudgeTargets(budget);
    const nudgeReserve = Math.min(Math.max(1, Math.floor(budget / 3)), dueNudges.length, budget);

    // The snapshot check above is advisory (read-then-send races with manual
    // inbox sends); this atomic per-send reservation is the hard ledger. The
    // send window (9a-6p CT) never crosses UTC midnight, so the fixed UTC-day
    // window aligns with the Chicago-day cap.
    const reserveCapSlot = async () => (await rateLimit("smsqueue:day", cap, 86_400)).ok;

    const suggestions = await suggestedTexts(budget - nudgeReserve);
    const sent: Array<{ company: string; phone: string; sid?: string; error?: string }> = [];
    for (const s of suggestions) {
      if (!(await reserveCapSlot())) break;
      const res = await sendSms({
        to: s.phone,
        body: s.opener,
        kind: "text_queue",
        companyKey: s.companyKey,
        refId: s.companyId,
      });
      sent.push(
        res.ok
          ? { company: s.name, phone: s.phone, sid: res.sid }
          : { company: s.name, phone: s.phone, error: res.error }
      );
    }

    // Remaining budget goes to the no-reply follow-up (the SMS mirror of the
    // email 48h nudge): silent openers get the pitch + claim link once, then
    // quiet forever.
    const nudges = dueNudges.slice(0, budget - sent.filter((r) => r.sid).length);
    const nudged: Array<{ company: string; phone: string; sid?: string; error?: string }> = [];
    for (const n of nudges) {
      if (!(await reserveCapSlot())) break;
      const res = await sendSms({
        to: n.phone,
        body: n.text,
        kind: "text_nudge",
        companyKey: n.companyKey,
        refId: n.companyId,
      });
      nudged.push(
        res.ok
          ? { company: n.name, phone: n.phone, sid: res.sid }
          : { company: n.name, phone: n.phone, error: res.error }
      );
    }

    return Response.json({
      dailyCap: cap,
      sentToday:
        used + sent.filter((r) => r.sid).length + nudged.filter((r) => r.sid).length,
      sent,
      nudged,
    });
  });
}
