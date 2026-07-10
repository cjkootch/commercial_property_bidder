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

### 1. Ionwave RFP portals — deep probe (prep for a one-parser feed)

Your sweep found SAWS (15 live), City of El Paso (7), and El Paso County (6)
all on Ionwave (`*.ionwave.net/SourcingEvents.aspx?SourceType=1`, server-
rendered HTML tables: Bid Number | Title | Type | Organization | Issue Date |
Close Date). Before we build the parser:

- For each of the three portals: capture the exact table HTML structure
  (tag/class/id skeleton, one sanitized sample row per portal), pagination
  behavior, and whether closed/awarded events leak into `SourceType=1`.
- Confirm the columns are identical across portals or document every
  divergence — the whole point is ONE parser.
- Sweep for more Texas Ionwave tenants in or near our nine metros (Houston,
  DFW, San Antonio, Austin, El Paso, Corpus, Waco, Brownsville, Beaumont) by
  probing `<agency>.ionwave.net` slugs. List hits with live event counts.
- Grounds relevance check: of the ~28 live events across the three known
  portals, how many are landscaping/grounds/mowing/irrigation/tree/janitorial
  adjacent? We need the hit rate to size the feed's value.

Deliverable: `docs/market-research/ionwave-portals-<date>.md`.

### 2. McAllen–Hidalgo — full market workup (candidate metro #10)

Honorable mention in your sweep (LGBS 53). Open questions:

- Hidalgo CAD parcels: is there an AGOL-hosted county-scale layer (the sweep
  found only `gismap.mcallen.net`, a non-AGOL host we may not be able to reach
  from Vercel)? Search the AGOL catalog hard — vendor orgs, city orgs, Maplink/
  GenCode-style mirrors. We need: owner, PTAD state class (or a zoning layer
  fallback), market value, acreage. Note vintage (tax year) — current roll
  beats stale snapshot.
- TABC pending count for Hidalgo County; note the top cities (McAllen,
  Edinburg, Mission, Pharr).
- Bonfire/other procurement portals for McAllen, Edinburg, Mission, Pharr,
  Hidalgo County, the ISDs, and South Texas College.
- MSA sanity: proposed bbox must not overlap Brownsville–Harlingen
  (`[-97.87, 25.83, -97.15, 26.53]`) — Hidalgo sits west of Cameron; propose
  an east edge that cleanly cedes Harlingen to Brownsville.

Deliverable: `docs/market-research/mcallen-hidalgo-<date>.md`.

### 3. Fresh-deed hunt — Tarrant & Dallas county clerks

Same playbook as your Bexar/El Paso hunt (that report's format was exactly
right). For each county: does the county CLERK expose a public, no-login
official-records search with a recorded-date-range filter and deed doc-type
filtering? Check for GovOS/Kofile "PublicSearch" instances
(`<county>.tx.publicsearch.us`) first, then whatever the clerk actually runs.
Measure certified-through freshness and recent recording volume (last 10
days). Flag anything gated. This decides whether DFW residential sourcing can
upgrade from CAD-lag (weeks) to days-fresh.

Deliverable: `docs/market-research/fresh-deed-sources-tarrant-dallas-<date>.md`.

## Done

- 2026-07-10 — Texas metro expansion sweep →
  `docs/market-research/texas-metro-sweep-2026-07-10.md` (drove metros #8
  Brownsville and #9 Beaumont, both live same day).
- 2026-07-10 — Bexar/El Paso fresh-deed hunt →
  `docs/market-research/fresh-deed-sources-bexar-elpaso.md` (Bexar: usable
  now, pending human export-limit check; El Paso: blocked on Turnstile,
  human decision pending).
