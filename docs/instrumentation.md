# Instrumentation rules — if it sends, it logs

Written after two shipped paths were found flying blind (the 48h nudge and
the residential publish alert sent emails whose opens/clicks the webhook
silently dropped), and an A/B test ran with no readable results. Tracking is
how the system improves; a path without it can't be judged, only vibed about.

## The rule

**Every outbound email path must, before it ships:**

1. **Persist its Resend message id.**
   - Campaign sends: in their domain table (`buyer_outreach.resend_message_id`,
     follow-up steps in `nudge_message_id`; `outreach` for owner mail).
   - Everything else: pass `logAs: { kind, buyerId?, refId? }` to
     `sendEmail()` — one parameter, full tracking via the `email_send` table.
2. **Be matched in the Resend webhook** (`app/api/webhooks/resend/route.ts`).
   `logAs` paths get this for free; a new domain-table column needs its own
   matcher (see the nudge matchers for the pattern).
3. **Surface somewhere a human looks** — `/campaigns`, the daily digest, or
   an operator alert. Data nobody sees is the same as no data.
4. **If it's an experiment, the results must be computable** from our own
   tables (not Resend-side tags alone) and shown in the digest. The subject
   A/B test reads its variant from the stored `SUBJECT[A|B]:` message prefix.

## SMS (Twilio)

The rule extends to texts: every outbound SMS goes through
`sendSms()` (`lib/integrations/twilio.ts`), which refuses opted-out numbers
and logs an `sms_send` row; delivery state updates via the status callback on
`app/api/webhooks/twilio/route.ts`, and inbound replies log there too
(direction `in`) + page the operator. STOP/START keywords maintain
`sms_opt_out`. The thread renders on the company profile and the /messages/sms
inbox, and the channel's numbers (sends, delivery rate, replies, opener reply
rate, AI replies, opt-outs, cap usage) roll up on /reports and in the
snapshot markdown.

First-touch openers are automated under the operator's standing approval
(2026-07-12, "blanket auth" — same env-var pattern as the demand engine):
`/api/cron/sms-queue` sends the two-step opener to the top of the text queue,
capped at TEXT_QUEUE_DAILY_CAP/day shared with manual sends, weekday
business hours on Texas wall clock only (`withinSmsSendWindow`, enforced in
the route, not just the schedule), targeted stored numbers only (engaged or
phone-only prospects holding a live claim link — never generated lists),
kill switch `SMS_AUTOPILOT=0`.

The cadence mirrors email's 48h nudge: an opener that gets NO reply within
48h earns ONE follow-up (kind `text_nudge`, same cron, leftover budget after
fresh openers) delivering the step-2 pitch + claim link it never earned by
replying — then silence forever. Same shared daily cap, same window, skips
replies/opt-outs/converted/blocked, and never fires past claim-token life
(25d). A reply at any point routes the number to the AI conversation path
instead.

Conversations are AI-answered (same standing approval): the inbound webhook
has Claude reply under the draft-button rules (deliver the claim link on
interest, never invent details, polite close on not-interested), capped at
4 AI replies per thread before going quiet for human takeover. Every
exchange still pages the operator — the alert email shows the prospect's
text AND the AI's answer, with a link to take over the thread. Kill switch:
`SMS_AI_AUTOREPLY=0`. STOP/opt-outs are never answered.

## Exemptions

- Transactional mail the buyer asked for this second (magic links, receipts,
  credit notices): message id persistence optional; tracking adds noise.
- Operator-facing mail (alerts, the digest itself): no tracking.

## Review question for every PR that sends anything

> "When this works, which number goes up — and where do we see it?"

If the answer isn't a table column plus a report surface, the PR isn't done.
