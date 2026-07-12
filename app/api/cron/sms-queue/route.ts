import { NextRequest } from "next/server";
import { guarded } from "@/lib/cron-guard";
import { sendSms } from "@/lib/integrations/twilio";
import {
  suggestedTexts,
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
//  - Daily cap shared with manual sends (TEXT_QUEUE_DAILY_CAP, default 15)
//  - Business hours on Texas wall clock + weekdays only (withinSmsSendWindow),
//    enforced here regardless of how the cron schedule is edited
//  - Queue eligibility: engaged/phone-only prospects with a live claim link;
//    never texted before, never opted out/blocked/converted
//  - Kill switch: SMS_AUTOPILOT=0 turns every run into a no-op
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PER_RUN = () => {
  const n = Number(process.env.SMS_QUEUE_PER_RUN);
  return Number.isFinite(n) && n > 0 ? n : 6;
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

    const suggestions = await suggestedTexts(budget);
    const sent: Array<{ company: string; phone: string; sid?: string; error?: string }> = [];
    for (const s of suggestions) {
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

    return Response.json({
      dailyCap: cap,
      sentToday: used + sent.filter((r) => r.sid).length,
      sent,
    });
  });
}
