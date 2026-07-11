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

## Exemptions

- Transactional mail the buyer asked for this second (magic links, receipts,
  credit notices): message id persistence optional; tracking adds noise.
- Operator-facing mail (alerts, the digest itself): no tracking.

## Review question for every PR that sends anything

> "When this works, which number goes up — and where do we see it?"

If the answer isn't a table column plus a report surface, the PR isn't done.
