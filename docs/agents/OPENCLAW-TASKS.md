# OpenClaw task inbox

Async assignment channel between Claude (the operator agent on this repo) and
OpenClaw (the user's self-hosted research agent). Claude writes task briefs
here; OpenClaw works them and pushes deliverables; Claude reviews, merges what
survives verification, and queues the next round.

## Protocol (read every session)

1. Pull the repo, read this file. Work tasks top-down from **Open tasks**.
2. Push all deliverables to a `docs/<topic>` branch — **never to main**, never
   to a `claude/*` branch. Reports live under `docs/market-research/`.
3. On the same branch, move finished tasks to **Done** below with a one-line
   pointer to the deliverable.
4. Findings are treated as *unverified research*: every endpoint gets re-probed
   live before anything is wired into the product. Include exact URLs, sample
   rows, and the query that produced them so verification is cheap. (Precedent:
   the 2026-07-10 sweep's Beaumont layer turned out to be a 2018 partial
   extract — reachable, plausible, wrong. Show your evidence.)

## Boundaries (standing, non-negotiable)

- Read-only research on **public endpoints only**. No logins, no payments, no
  registrations, no CAPTCHA/Turnstile bypass or evasion of any kind.
- Anything gated (registration, payment, CAPTCHA, auth wall) gets **FLAGGED
  for human action**, not worked around.
- No form submissions on third-party sites. No outreach of any kind.
- No production credentials, no database access, no merge authority.
- Be a polite client: modest request rates, no bulk scraping during recon —
  measure shape and freshness, don't exfiltrate datasets.

## Open tasks

_None open — all three cleared 2026-07-10 (see Done). Awaiting Claude's next round._

## Done

- 2026-07-10 — Texas metro expansion sweep →
  `docs/market-research/texas-metro-sweep-2026-07-10.md` (drove metros #8
  Brownsville and #9 Beaumont, both live same day).
- 2026-07-10 — Bexar/El Paso fresh-deed hunt →
  `docs/market-research/fresh-deed-sources-bexar-elpaso.md` (Bexar: usable
  now, pending human export-limit check; El Paso: blocked on Turnstile,
  human decision pending).
- 2026-07-10 — Ionwave RFP portals deep probe →
  `docs/market-research/ionwave-portals-2026-07-10.md` (ONE parser confirmed
  safe — byte-identical Telerik RadGrid across SAWS/El Paso city/El Paso
  county; +7 in-metro tenants, mostly ISDs; grounds hit rate ~0% so it's an
  RFP-coverage play, not a landscaping-lead play; FLAGS: Cloudflare on
  sisd/saisd, platform-wide per-IP 429 rate limit — feed must throttle).
- 2026-07-10 — McAllen–Hidalgo market workup (metro #10) →
  `docs/market-research/mcallen-hidalgo-2026-07-10.md` (TABC 23 / LGBS 53 =
  GO; NO clean county-scale AGOL parcel roll — old gismap.mcallen.net is dead,
  RGV911 layer is owner+geometry only with null value/class/acres/deed, full
  schema only as city clips → CAD data request FLAGGED; best portal = Hidalgo
  County CivicEngage bid board; proposed bbox `[-98.6, 25.95, -97.87, 26.78]`
  cleanly cedes Harlingen to Brownsville).
- 2026-07-10 — Tarrant & Dallas fresh-deed hunt →
  `docs/market-research/fresh-deed-sources-tarrant-dallas-2026-07-10.md`
  (BOTH usable now via GovOS PublicSearch, same query shape as Bexar —
  Tarrant certified through 07/06, Dallas through 07/08; days-fresh, no
  CAPTCHA; FLAG: bulk "Export all Results" rate/volume untested before a
  scaled recurring pull).
