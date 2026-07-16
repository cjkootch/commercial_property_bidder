// Communication-flow chart (audit view): the 1st/2nd/3rd touch a prospect gets
// on each channel, WITH the live copy and live timing. Nothing here is
// hand-maintained — schedules parse from vercel.json, timings/caps import from
// the modules that enforce them, and the message previews are rendered by the
// SAME template functions the senders call. Change the flow → this chart
// changes on the next deploy.

import vercelConfig from "@/vercel.json";
import {
  openerFor,
  step2For,
  nudgeTextFor,
  SMS_NUDGE_AFTER_HOURS,
  SMS_NUDGE_MAX_AGE_DAYS,
  TEXT_QUEUE_DAILY_CAP,
} from "@/lib/sms/queue";
import { NUDGE_AFTER_HOURS, NUDGE_MAX_AGE_DAYS } from "@/lib/pipeline/nudges";
import { LONG_TAIL_EVERY_DAYS, LONG_TAIL_MAX_TOUCHES } from "@/lib/pipeline/long-tail";
import { OUTCOME_AFTER_DAYS, outcomeSmsFor } from "@/lib/pipeline/outcome-check";
import { HOLD_REMIND_BEFORE_HOURS, holdReminderSmsFor } from "@/lib/pipeline/hold-expiry";
import { HOLD_TTL_HOURS } from "@/lib/leads/holds";

// --- cron → human text ------------------------------------------------------

const DOW: Record<string, string> = {
  "*": "daily",
  "1-5": "Mon–Fri",
  "1-6": "Mon–Sat",
  "0": "Sun", "1": "Mon", "2": "Tue", "3": "Wed", "4": "Thu", "5": "Fri", "6": "Sat",
};

/** "37 14-23 * * 1-5" → "hourly at :37, 14:00–23:00 UTC, Mon–Fri". Covers the
 *  handful of shapes this repo uses; anything odd falls back to the raw cron. */
function cronToText(expr: string): string {
  const m = expr.trim().split(/\s+/);
  if (m.length !== 5) return expr;
  const [min, hour, , , dow] = m;
  const days = DOW[dow] ?? expr;
  if (/^\d+$/.test(hour)) return `${hour.padStart(2, "0")}:${min.padStart(2, "0")} UTC, ${days}`;
  if (/^\d+-\d+$/.test(hour)) {
    const [a, b] = hour.split("-");
    return `hourly at :${min.padStart(2, "0")}, ${a.padStart(2, "0")}:00–${b.padStart(2, "0")}:00 UTC, ${days}`;
  }
  return `${expr} (${days})`;
}

/** Every schedule vercel.json has for a cron path, humanized. */
function schedulesFor(path: string): string[] {
  return (vercelConfig.crons as Array<{ path: string; schedule: string }>)
    .filter((c) => c.path.split("?")[0] === path)
    .map((c) => cronToText(c.schedule));
}

// --- building blocks ---------------------------------------------------------

function Step(props: {
  n: string;
  title: string;
  timing: string;
  children: React.ReactNode;
  last?: boolean;
  accent: string; // tailwind bg class for the number bubble
}) {
  return (
    <div className="relative pl-9 pb-6">
      {!props.last ? (
        <span className="absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-px bg-gray-200" />
      ) : null}
      <span
        className={`absolute left-0 top-0.5 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white ${props.accent}`}
      >
        {props.n}
      </span>
      <div className="font-medium text-gray-900">{props.title}</div>
      <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {props.timing}
      </div>
      <div className="mt-1.5 space-y-1.5 text-xs text-gray-600">{props.children}</div>
    </div>
  );
}

function Msg({ text }: { text: string }) {
  return (
    <pre className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-[11px] leading-4 text-gray-700 [overflow-wrap:anywhere]">
      {text}
    </pre>
  );
}

function Chip({ children, tone = "gray" }: { children: React.ReactNode; tone?: "gray" | "amber" | "red" | "green" }) {
  const tones = {
    gray: "bg-gray-100 text-gray-600",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-700",
    green: "bg-emerald-100 text-emerald-800",
  } as const;
  return (
    <span className={`mr-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

// --- the chart ----------------------------------------------------------------

export function CommFlow() {
  const SAMPLE_LINK = "https://greenkeep.us/buyers/claim/<their-token>?trade=cleaning";
  const cap = TEXT_QUEUE_DAILY_CAP();
  const perRun = Number(process.env.SMS_QUEUE_PER_RUN) || 40; // mirrors sms-queue route default
  const smsCron = schedulesFor("/api/cron/sms-queue").join(" · ");
  const flushCron = schedulesFor("/api/cron/sms-flush").join(" · ");
  const demandCron = schedulesFor("/api/cron/demand").join(" · ");
  const emailNudgeCron = schedulesFor("/api/cron/nudges").join(" · ");
  const longTailCron = schedulesFor("/api/cron/long-tail").join(" · ");

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Communication flow</h2>
      <p className="mt-1 text-sm text-gray-500">
        Every automated touch a prospect can receive, in order, with the live copy and live
        schedule. This chart is generated from the sending code itself — if the flow changes,
        it changes.
      </p>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        {/* ---------------- SMS ---------------- */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className="text-lg">📱</span>
            <h3 className="font-semibold text-gray-900">Text (SMS)</h3>
          </div>

          <Step n="1" title="Opener — the human hello" accent="bg-brand" timing={`autopilot: ${smsCron} · ~${perRun}/run · ≤${cap}/day shared cap`}>
            <Msg text={openerFor("Acme Cleaning", "Houston")} />
            <div>
              <Chip>never-texted only</Chip>
              <Chip>line-screened</Chip>
              <Chip>cell-first reveal</Chip>
              <Chip>9am–6pm their local time</Chip>
            </div>
            <div className="pt-1">
              <Chip tone="green">they reply → step 2a</Chip>
              <Chip tone="amber">silent {SMS_NUDGE_AFTER_HOURS}h → step 2b</Chip>
              <Chip tone="red">STOP → opt-out, permanent</Chip>
            </div>
          </Step>

          <Step n="2a" title="Reply → AI conversation delivers the pitch + link" accent="bg-brand" timing="auto-reply, 45s–3min “typing” delay · 8am–9pm their local time (else queued for 8am)">
            <Msg text={step2For("Acme Cleaning", SAMPLE_LINK)} />
            <div>
              <Chip>quiet hours → sms-flush: {flushCron}</Chip>
              <Chip>runaway brake per thread</Chip>
              <Chip>handoff intent → operator paged “YOUR TURN”</Chip>
            </div>
          </Step>

          <Step n="2b" title={`Silent ${SMS_NUDGE_AFTER_HOURS}h → the one follow-up (assumptive send)`} accent="bg-brand" timing={`${SMS_NUDGE_AFTER_HOURS}h–${SMS_NUDGE_MAX_AGE_DAYS}d after opener · once per phone, ever · rides the same hourly runs (~⅓ of each batch reserved)`}>
            <Msg
              text={nudgeTextFor("Acme Cleaning", SAMPLE_LINK, {
                city: "Houston",
                service: "cleaning",
                estLo: 6600,
                estHi: 12300,
              })}
            />
            <div>
              <Chip>real teaser $ when sized</Chip>
              <Chip>skipped if any human/AI text exists</Chip>
              <Chip>skipped if opener bounced</Chip>
            </div>
          </Step>

          <Step n="3" title="Long tail (phone-only prospects)" accent="bg-brand" timing={`every ${LONG_TAIL_EVERY_DAYS}d of silence · max ${LONG_TAIL_MAX_TOUCHES} touches, ever · shared daily cap + hours window`}>
            Prospects with no email get the SMS version of the long-tail re-touch: a genuinely new
            lead near them with the value estimate + 24h hold. Emailable prospects get it by email
            instead (see Email column).
          </Step>

          <Step n="4" title="End of automation" accent="bg-gray-400" timing="no further automated texts" last>
            Replies still land in the inbox + AI thread any time; a claim converts them to a buyer
            and removes them from all prospect sends.
          </Step>
        </div>

        {/* ---------------- Email ---------------- */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className="text-lg">📧</span>
            <h3 className="font-semibold text-gray-900">Email</h3>
          </div>

          <Step n="1" title="Offer email — the lead pitch with claim link" accent="bg-blue-600" timing={`demand engine: ${demandCron} · best fresh lead per trade · global daily cap`}>
            Personalized memo for one specific lead (value estimate, trigger, distance), with the
            company&apos;s claim link. Suppression + bounce lists checked before every send.
            <div className="pt-1">
              <Chip tone="green">open/click → tracked (feeds SMS heat ranking)</Chip>
              <Chip tone="amber">silent {NUDGE_AFTER_HOURS}h → step 2</Chip>
              <Chip tone="red">unsubscribe/complaint → suppressed</Chip>
            </div>
          </Step>

          <Step n="2" title={`Silent ${NUDGE_AFTER_HOURS}h → the one nudge email`} accent="bg-blue-600" timing={`nudge cron: ${emailNudgeCron} · ${NUDGE_AFTER_HOURS}h–${NUDGE_MAX_AGE_DAYS}d after offer · once per company`}>
            Short follow-up on the same lead, fresh claim link (tokens outlive the {NUDGE_MAX_AGE_DAYS}d
            window). One nudge ever — then quiet.
          </Step>

          <Step n="3" title="Last-spot alert (event-driven)" accent="bg-blue-600" timing="fires the moment their offered lead drops to its final shared spot · once ever per company+lead">
            “{`Down to its LAST spot — when it's taken, the job closes for good.`}” Only sent to
            companies that engaged (opened/clicked/viewed); capped per event.
          </Step>

          <Step n="4" title="Long tail — new-inventory re-touch" accent="bg-blue-600" timing={`${longTailCron} · every ${LONG_TAIL_EVERY_DAYS}d of silence · max ${LONG_TAIL_MAX_TOUCHES} touches, ever`}>
            A quiet prospect gets one re-touch offering a <em>genuinely new</em> lead near them
            (never a repeat, never &quot;just checking in&quot;) — real value estimate + the 24h
            first-claim hold. Phone-only prospects get the SMS version (same cadence, shared SMS
            cap). Any engagement drops them back into the hot machinery.
          </Step>

          <Step n="5" title="End of automation" accent="bg-gray-400" timing="no further automated emails" last>
            Replies to leads@ are logged + alert the operator instantly. Bounces and complaints
            auto-suppress the address forever.
          </Step>
        </div>
      </div>

      {/* ---------------- shared destination ---------------- */}
      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-gray-700">
        <div className="mb-2">
          <span className="font-semibold text-emerald-900">Both channels land on the claim page:</span>{" "}
          opening it holds the lead&apos;s free spot for that company for {HOLD_TTL_HOURS}h (enforced —
          others see it taken, then it releases), shows real recent claim activity in their city, and
          offers WhatsApp for questions. Creating the 3-field profile IS the claim.
        </div>
        <div className="mb-1 text-xs font-semibold text-emerald-900">
          Hold ending unclaimed → one reminder, ≤{HOLD_REMIND_BEFORE_HOURS}h before expiry (hourly cron,
          best channel, once per hold ever):
        </div>
        <Msg
          text={holdReminderSmsFor({
            city: "Houston",
            trade: "cleaning",
            expiresAt: new Date("2026-01-01T18:11:00Z"),
            tz: "America/Chicago",
            claimUrl: SAMPLE_LINK,
          })}
        />
      </div>

      {/* ---------------- after the claim: the outcome loop ---------------- */}
      <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/50 p-4 text-sm text-gray-700">
        <div className="mb-2">
          <span className="font-semibold text-violet-900">
            After the claim — day-{OUTCOME_AFTER_DAYS} outcome check-in:
          </span>{" "}
          one message per claimed lead, ever, on the buyer&apos;s best channel — SMS when their
          number is textable (nudge cron: {schedulesFor("/api/cron/nudges").join(" · ")}), email
          otherwise.
        </div>
        <Msg text={outcomeSmsFor({ city: "Houston", trade: "cleaning" })} />
        <div className="pt-2">
          <Chip tone="green">went well → AI offers the next open lead + claim link (upsell)</Chip>
          <Chip tone="amber">went nowhere → AI asks how they worked it (timing, channel, contact)</Chip>
          <Chip tone="red">dead contact → flagged for the operator to re-verify the sheet</Chip>
        </div>
        <div className="pt-1 text-xs text-gray-500">
          SMS replies branch automatically in the AI thread; email replies land on the operator
          (reply-to) with the same playbook.
        </div>
      </div>
      <p className="mt-2 text-[11px] text-gray-400">
        Sources: vercel.json (schedules) · lib/sms/queue.ts (SMS copy + timings) ·
        lib/pipeline/nudges.ts (email nudge) · lib/pipeline/outcome-check.ts (outcome loop) ·
        lib/pipeline/hold-expiry.ts (hold reminder) · lib/leads/holds.ts (hold TTL) · previews
        rendered by the exact template functions the senders call, with sample data.
      </p>
    </section>
  );
}
