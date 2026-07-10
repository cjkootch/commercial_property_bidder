# Email Automation — Status and Roadmap

Origin: an external review (Jules, PR #47) proposed an automation roadmap in
July 2026. This document records what was adopted, what already existed, and
what was rejected with reasons — so the next reviewer doesn't re-propose them.

## What's automated today

- **Prospecting campaigns** — `lib/pipeline/buyer-prospecting.ts`: per-trade
  qualification, geo routing by market, A/B subjects, politeness caps,
  atomic queued→sent claims, permanent company blocklist. Sends are
  operator-gated by design (`&send=1` + explicit approval) — that gate is a
  product decision, not a missing feature.
- **48h nudges** — daily cron (`/api/cron/nudges?apply=1`), engaged-only,
  claim-token-age-capped, one per company, atomic claim before send.
- **New-job alerts to buyers** — `notifyBuyersOfFresh` (permits feed):
  opted-in buyers, radius-gated, teaser numbers only.
- **Residential package publish alerts** — `lib/residential/alerts.ts`:
  operator's Publish click emails opted-in buyers within service range, once
  per buyer per package ever (far-future usage-counter marker). *(Adopted
  from the review.)*
- **Abandoned-checkout recovery** — checkout sessions expire after 3h; the
  Stripe `checkout.session.expired` webhook sends one honest nudge per buyer
  per item, only while the item is still genuinely available. Requires the
  `checkout.session.expired` event enabled on the Stripe webhook endpoint.
  *(Adopted from the review.)*
- **Delivery + lifecycle** — unlock delivery, credit notices, First Look
  renewals/cancellations, magic-link sign-in (branded template), inbound
  reply alerts (Resend receiving → operator email), bounce → suppression,
  RFC-8058 one-click unsubscribe everywhere.

## Rejected from the review, and why

- **External job queue (QStash / Inngest)** — our volume runs on Vercel crons
  plus atomic conditional updates (the Neon HTTP driver has no transactions;
  the codebase is built around single-statement claims). An external queue
  adds an infra dependency and a second source of truth without solving a
  problem we have. Revisit only if send volume outgrows cron windows.
- **`campaign_segments` table** — segmentation is computed live per campaign
  (trade, radius, engagement, suppression). A materialized membership table
  can go stale between refreshes; live queries can't. No table.
- **React Email / MJML templating** — the inline HTML builders are small,
  consistent, and tested in real clients. A templating stack is a nice-to-have
  once template count grows; not now.
- **Welcome drip sequence** — deliberately not automated. Outreach posture is
  honest and sparse; a 3-part automated drip to fresh signups burns trust for
  little conversion at current volume. Revisit with data.

## Open ideas (not built)

- Residential **demand-gen**: pitch published packages to residential-only
  trades via the prospecting engine (the campaign machinery already supports
  it — needs residential trade definitions + copy).
- Engagement-based resurfacing for buyers who opened but never claimed.
