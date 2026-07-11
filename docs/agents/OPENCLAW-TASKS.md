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

_None open — round 3 was run in-house by Claude 2026-07-10 (operator asked
for same-night turnaround while OpenClaw was busy; see Done). Round 4 TBD._

<!-- Round-3 briefs preserved below for reference; all delivered.

### 4. CivicEngage/CivicPlus bid-board tenant sweep (the Ionwave replacement)

Your McAllen report found Hidalgo County's CivicEngage bid board
(`hidalgocounty.us/Bids.aspx?CatID=All&showAllBids=on`) is server-rendered,
no-login, raw-HTTP-parseable — and CivicPlus/CivicEngage powers hundreds of
Texas municipal sites. The Ionwave feed died on content (0% grounds); this
sweep decides whether a one-parser CivicEngage feed lives or dies the same way.

- Sweep our nine metros (Houston, DFW, San Antonio, Austin, El Paso, Corpus,
  Waco, Brownsville, Beaumont) — core cities, counties, and major suburbs
  (Arlington, Plano, Round Rock, Sugar Land, Pasadena, Laredo excluded) — for
  live `/Bids.aspx` boards. CivicPlus tenants are usually the agency's own
  domain (`<city>tx.gov`, `<county>.us`, etc.); detection = GET `/Bids.aspx`
  returning the bid-table page.
- For each live board: open-bid count, one sanitized sample row, and whether
  the table HTML shape matches Hidalgo County's (one parser?).
- **The deciding number:** grounds hit rate across ALL open bids found, using
  the same keyword set as the Ionwave probe (landscap, grounds, mow,
  irrigation, tree/arbor, janitor/custodial services, right-of-way, median,
  park/athletic-field maintenance). Distinguish services from supplies.
- Politeness: one GET per candidate domain, paced; skip anything gated.

Deliverable: `docs/market-research/civicengage-bid-boards-<date>.md`.

### 5. Hidalgo TABC per-city split (small)

Same Socrata dataset as the probe (`data.texas.gov/resource/mxm5-tdpj.json`),
`upper(county)='HIDALGO'`, but grouped by city — how do the 23 pending split
across McAllen / Edinburg / Mission / Pharr / elsewhere? Also note the address
field quality (full situs?). This sizes how much of metro #10's TABC signal
the Edinburg+Weslaco parcel clips can actually gate, informing whether we
launch with partial coverage or wait for the CAD data request.

Deliverable: fold into a short section appended to
`docs/market-research/mcallen-hidalgo-<date>-addendum.md`.

### 6. Fresh-deed hunt — Harris & Travis county clerks (completes the set)

Same playbook as your Bexar and Tarrant/Dallas hunts (both were exactly the
right format). Two counties, one question each:

- **Harris (Houston)**: check `harris.tx.publicsearch.us` first; if absent,
  the clerk's own system (harriscountyclerk.org / ccinfo). Public, no-login,
  recorded-date-range + deed doc-type filter? Certified-through freshness and
  last-10-day volume.
- **Travis (Austin)**: this one matters double — Travis CAD deed data is
  frozen ~2 years stale (verified 2026-07-09), which is why Austin residential
  is deferred. A days-fresh clerk source would unblock the entire Austin
  new-mover product. Check `travis.tx.publicsearch.us`, then the clerk's
  official records search.

Flag anything gated; do not bypass. Deliverable:
`docs/market-research/fresh-deed-sources-harris-travis-<date>.md`.

-->

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
- 2026-07-10 — [run by Claude] CivicEngage bid-board sweep →
  `docs/market-research/civicengage-bid-boards-2026-07-10.md` (6 live boards
  of 49 probed, 35 unique bids, **0 grounds-relevant** — feed killed on
  content, same as Ionwave; quarterly re-probe trigger noted).
- 2026-07-10 — [run by Claude] Hidalgo TABC per-city split →
  `docs/market-research/mcallen-hidalgo-2026-07-10-addendum.md` (Edinburg 7 /
  McAllen 4 / Mission 4 / Pharr 2 / Weslaco 2 / other 4; the city clips gate
  9 of 23 = 39% — recommendation stays: CAD data request before building
  metro #10).
- 2026-07-10 — [run by Claude] Harris & Travis fresh-deed hunt →
  `docs/market-research/fresh-deed-sources-harris-travis-2026-07-10.md`
  (**travis.tx.publicsearch.us EXISTS** — same GovOS platform, RP/Land
  Records confirmed from app config; 5-min attended check of the certified
  date decides Austin residential. Harris: no PublicSearch tenant; clerk's
  own ASP.NET search has the right fields, no CAPTCHA, but bounced to its
  maintenance page at probe time — attended re-check; HCAD fallback fine).
