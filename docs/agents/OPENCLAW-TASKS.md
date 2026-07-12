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

_None open — round 6 cleared 2026-07-11 (see Done). Round 7 TBD._

<!-- Round-6 briefs preserved below for reference; all delivered.

### 13. PublicSearch underlying JSON API recon — unblock the 7-county deed fetcher

Your round-5 DOM map came with a build-blocking correction: a date-range-only
deep link does NOT render — the UI demands a `searchValue`. Before we scrape
DOM at all, find out what the SPA itself calls. Open one tenant (Bexar), watch
the network panel, and map the XHR/JSON search API behind the React app:

- The search request: method, path, params/body — how do date range, doc
  type, page size, and offset encode? Critically: does the **API** accept a
  date-range query with an empty/wildcard search value even though the UI
  won't? (If yes, the fetcher skips DOM entirely and the col-N mapping
  problem evaporates.)
- The response schema: field names for grantor/grantee/doc type/recorded
  date/doc number/legal — one sanitized sample object.
- Confirm the same API shape on 2–3 more tenants (Dallas — the "Town" column
  outlier — plus Cameron or Hidalgo). Note any tenant-specific headers,
  tokens, or cookies the requests carry (session-scoped? expiring?).
- Pagination limits: max page size the API honors, and whether deep offsets
  (500+) work or degrade.
- Same politeness rules as round 5: shape only, ≥10s pacing, no bulk pulls;
  report any 401/403/429 posture, don't push through it.

Deliverable: `docs/market-research/publicsearch-api-recon-<date>.md`.

### 14. Tampa permit + code-enforcement signals — complete the Houston parity check

Round 5 greenlit Tampa on licenses/parcels/tax-deeds/recorder/procurement —
but our densest Texas signals are building permits and 311/code enforcement,
and the state scout never probed those for Tampa. Same shape as your round-4
permit-311 sweep, for: **City of Tampa**, **unincorporated Hillsborough
County**, and (briefly) Temple Terrace/Plant City:

- **Building permits**: open-data endpoint (Tampa runs Accela — is there a
  Socrata/ArcGIS mirror, or only the Accela citizen portal?). Dataset id/URL,
  update cadence, valuation/cost field, commercial-vs-residential
  discriminator, issue date, address/coords quality, 3 sample rows. Say
  whether our Houston filter (`commercial + minCost + recency`) is
  expressible.
- **Code enforcement / 311**: case-type vocabulary (which types imply forced
  grounds/property maintenance: overgrowth, debris, dangerous structure,
  stagnant water), status fields, freshness, address quality, 3 sample rows.
- Note API-key/app-token requirements — FLAG for human signup, don't create
  accounts.

Deliverable: `docs/market-research/tampa-permit-311-<date>.md` with a
build/no-build call per leg.

### 15. Lead-pricing evidence, round 2 — archived rate cards + practitioner invoices

Round 5's caveat: no vendor publishes a clean per-trade card, and CraftJack's
numbers are stale secondary. Close the evidence gap from two public angles:

- **Archived rate cards**: Wayback Machine captures of Angi Leads /
  HomeAdvisor per-lead fee schedules and help-center pricing pages (they
  published more before 2024) — capture date, trade, price, shared/exclusive,
  citation URL per row.
- **Practitioner-quoted invoices**: public forum threads (r/landscaping,
  r/PestControlIndustry, r/HVAC, LawnSite — public pages only) where pros
  quote the actual per-lead price they were billed, by trade and year. These
  are anecdotes — mark each [ANECDOTE] with date + link; 5+ per trade where
  possible.
- **Subscription comps** for our First Look tier: current public pricing of
  Thumbtack promote/Angi Ads-style monthly plans — what does "priority
  access to leads" cost per month in the trades we sell?

Deliverable: `docs/market-research/lead-pricing-benchmark-round2-<date>.md`
with the three tables; keep the [EST]/[ANECDOTE] discipline.

_Priority: 13 first (unblocks the queued 7-county deed build), then 14,
then 15._

-->

<!-- Round-5 briefs preserved below for reference; all delivered.

### 10. Tampa–Hillsborough full market workup (Florida metro #1 prep)

Your state scout picked Florida/Tampa — now the build dossier, same shape as
your McAllen workup (that format drove two same-day metro launches):

- **DBPR alcohol licenses**: the daily application CSV — exact URL, schema,
  one sanitized sample row, how "pending/new application" is distinguished,
  premises-address quality, county/city fields. This is our TABC leg.
- **Hillsborough parcels**: the county appraiser layer — endpoint, row count,
  owner/use-class/value/acreage/sale-date fields, vintage, point-query test
  at a known commercial address (e.g. a Tampa mall), AGOL vs self-hosted.
- **Tax deeds**: the RealAuction pipeline + Lands Available list — what's
  public without login, list shape, upcoming-sale counts.
- **Clerk recorder**: freshness + platform (GovOS/Acclaim?), same checks as
  your Texas hunts.
- **Procurement**: verify the Bonfire tenant live; sweep Tampa/Hillsborough/
  HART/school-district slugs.
- **bbox proposal** for a `tampa` market entry (no Texas neighbors to
  collide with — note it's our first non-TX bbox).
- Quick-compare paragraph: does Orlando/Orange or Broward beat Tampa on any
  leg badly enough to reconsider?

Deliverable: `docs/market-research/tampa-hillsborough-<date>.md`.

### 11. Kofile/PublicSearch parser recon — the 7-county deed build prep

Dallas, Tarrant, Bexar, Cameron, Jefferson, Nueces, Hidalgo all run the same
platform. Before we build ONE fetcher, map the variance (shape only — no
bulk pulls, stay a polite client):

- Results-table DOM: are column ids/classes identical across all seven
  tenants? Selector map for GRANTOR/GRANTEE/DOC TYPE/RECORDED DATE/DOC
  NUMBER/LEGAL DESCRIPTION.
- **Doc-type vocabularies per county**: the Document Types filter list —
  which codes mean conveyance (WARRANTY DEED, DEED, SPECIAL WARRANTY...)
  per tenant. This is the residential "new mover" discriminator.
- Pagination + page-size mechanics; how the date-range + docType combo
  encodes in the URL (reproducible deep links per county).
- Observe (don't exercise) the "Export all Results" control: same on all
  tenants? Any visible row-limit note?
- Rate-limit posture: are there per-IP 429s like Ionwave? (Pace ≥10s;
  report anything you trip, do not push through it.)

Deliverable: `docs/market-research/kofile-parser-recon-<date>.md`.

### 12. Competitor lead-pricing benchmark (public pages only)

Our sheet prices ($ tiers by est. contract value) were set by reasoning,
not market evidence. Collect the PUBLIC pricing of the incumbent lead
sellers our buyers already know: Angi Leads/HomeAdvisor, Networx, CraftJack,
Thumbtack (pro pricing pages, help-center rate cards, published ranges) —
per-lead price by trade (pest, cleaning, HVAC, roofing, painting,
landscaping) and whether leads are shared or exclusive, plus any published
per-trade close-rate claims. No signups, no quote funnels — public pages
and archived help docs only; flag anything gated.

Deliverable: `docs/market-research/lead-pricing-benchmark-<date>.md` with a
table: source | trade | shared/exclusive | price | citation URL.

_Priority: 11 first (unblocks a build already queued), then 10, then 12._

-->

<!-- Round-4 briefs preserved below for reference; all delivered.

### 7. Permit + 311 signal expansion — DFW, San Antonio, Austin (the big one)

Houston runs four signal feeds; Dallas/SA/Austin each run two. New signal
TYPES in metros we already sell multiply against 11 trades and existing
demand machinery — better ROI than new metros. For each of Dallas, Fort
Worth, Arlington, San Antonio, and Austin:

- **Building permits**: the city's open-data endpoint (all five run Socrata
  or ArcGIS open-data portals). Document: dataset id/URL, update cadence
  (daily?), fields for valuation/cost, work type, commercial-vs-residential
  discriminator, issue date, address/coords quality. Sample 3 rows. Our
  Houston permits feed filters `minCost` + commercial + recency — say
  whether the same filter is expressible.
- **Code violations / 311**: the city's dataset. Document: case-type
  vocabulary (which types imply forced property maintenance: high weeds,
  dumping/debris, graffiti, stagnant water, dangerous structure), status
  fields, freshness, address quality. Sample 3 rows.
- Note any API-key/app-token requirements (Socrata tokens are free —
  FLAG for human signup rather than creating one).

Deliverable: `docs/market-research/permit-311-signals-<date>.md`, one
section per city, with a build-order recommendation (which city's data is
cleanest first).

### 8. Clerk fresh-deed hunt — Cameron, Jefferson, Nueces, McLennan, Hidalgo

Completes the residential-expansion map (Bexar/Tarrant/Dallas verified
open; El Paso + Travis blocked on Cloudflare). Same playbook and format as
your prior hunts. For each county: check `<county>.tx.publicsearch.us`
first, then the clerk's own system. Public, no-login, recorded-date-range +
deed doc-type filter? Certified-through freshness, last-10-day volume,
CAPTCHA posture. Flag anything gated; don't bypass.

Deliverable: `docs/market-research/fresh-deed-sources-round3-<date>.md`.

### 9. State scout: which state is "Texas 2.0"?

The stack's three signal legs are Texas agencies (TABC licenses, LGBS tax
sales, CAD parcel rolls). Before any out-of-state move, we need to know
which state replicates all the legs with Texas-grade openness. Score
Florida, Arizona, Georgia, North Carolina, and Tennessee on:

1. **Alcohol licensing**: does the state ABC publish pending/new license
   applications, machine-readable, with premises addresses? (Florida DBPR
   is the hypothesis to test first.)
2. **Tax sales**: statewide or major-county delinquent/tax-deed pipelines
   with public property lists (the LGBS equivalent).
3. **Parcel rolls**: assessor/appraiser data openness — statewide portals
   (e.g., FL DOR), per-county GIS, vendor patterns; owner/class/value/deed
   fields.
4. **Recorder freshness**: county recorder/clerk official-records search
   in the 2-3 biggest metros — GovOS/PublicSearch tenants count double
   (our scraper pattern already exists).
5. **Procurement**: Bonfire/Ionwave/CivicEngage footprint in the top metros.

Deliverable: `docs/market-research/state-scout-<date>.md` — one page per
state, a scored comparison table, and ONE recommended state with its
first-metro pick. Evidence rules as always: exact URLs, sample rows,
freshness measured not assumed.

_Priority: 7 first, then 8, then 9._

-->

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
- 2026-07-10 — Permit + 311 signal expansion (DFW/SA/Austin) →
  `docs/market-research/permit-311-signals-2026-07-10.md` (build order: SA +
  Austin first — both legs clean, Houston-style commercial+minCost+recency
  filter verified expressible; SA 311 has the richest granular vocabulary
  (Overgrown/Illegal Dumping/Graffiti/Dangerous). Fort Worth migrated Socrata
  →ArcGIS (old ids dead), permits ideal but code lags 3-4wk. Arlington
  permits-only (311 = mislabeled Greensboro NC data, walled). Dallas weakest:
  permits froze 2019, 311 ~92% single opaque "Code Concern" umbrella).
- 2026-07-10 — Clerk fresh-deed hunt, round 3 (Cameron/Jefferson/Nueces/
  McLennan/Hidalgo) → `docs/market-research/fresh-deed-sources-round3-2026-07-10.md`
  (clean sweep — NONE gated: 4 are Kofile PublicSearch on the Bexar query
  shape, days-fresh (Cameron 07/08, Jefferson 07/09, Nueces 07/09, Hidalgo
  07/08, vols 875-3,174/10d); McLennan = public Tyler portal, 1-click
  disclaimer only. Deed-only counts + McLennan freshness need a browser-click
  pass — harness limit, not site gating).
- 2026-07-10 — State scout "Texas 2.0" (FL/AZ/GA/NC/TN) →
  `docs/market-research/state-scout-2026-07-10.md` (**FLORIDA wins 5/5** —
  first metro Tampa/Hillsborough; standout = DBPR daily application CSV w/
  premises addresses (matches TABC) + statewide parcel FeatureServer +
  RealAuction tax deeds + Broward/Orange double-count recorders + live
  Bonfire. AZ/Phoenix A- runner-up (best open assessor API; procurement
  fragmented). GA beats TX on statewide recorder+license roll but retail
  licensing is local).
- 2026-07-11 — Kofile/PublicSearch parser recon (7-county deed build prep) →
  `docs/market-research/kofile-parser-recon-2026-07-11.md` (**ONE parser
  serves all 7** — identical PublicSearch SPA; must map by COLUMN INDEX not
  fixed selectors (cells carry only positional col-N classes). Dallas is the
  exception: inserts a "Town" col shifting Legal to col-10 → map header-text→
  index per tenant. URL contract identical: department=RP&searchType=
  quickSearch&searchValue=<term>&recordedDateRange=YYYYMMDD,YYYYMMDD +
  limit/offset 50/page. Correction: date-range-only deep-link does NOT render
  — searchValue is REQUIRED. Doc-type filter is coarse (REAL PROPERTY/OPR
  bucket); granular DEED/WARRANTY DEED is free-text in col-5 only → classify
  by regex, not filter. No rate-limiting tripped at ≥10s pacing; Export
  control present on all 7, login/pay-gated → flagged).
- 2026-07-11 — Tampa–Hillsborough market workup (FL metro #1) →
  `docs/market-research/tampa-hillsborough-2026-07-11.md` (all 5 legs GO;
  KEEP Tampa as #1. DBPR: prior /abt/eds/ URL DEAD → live set at /sto/
  file_download/extracts/ (daily.csv activity + bd400lic.csv master 219,946
  rows; pending vs active = Primary Status 10=In-Process/20=Current;
  Hillsborough = County code 39). Parcels: HCPA self-hosted (owner+sales, no
  value) + FDOR Cadastral 2025 (JV+DOR_UC); International Plaza point-query
  confirmed incl. 2025-12-31 $3.18M sale; hosted layer rejects numeric CO_NO
  → use spatial envelope. Tax deeds RealTaxDeed + Lands Available public.
  Recorder = clerk-hosted OBPA (not Acclaim/Kofile). Bonfire: Hillsborough
  ~25 open + HART; Tampa/airport on OpenGov, schools DemandStar. bbox
  [-82.8754, 27.5264, -82.0545, 28.1734] — first non-TX bbox).
- 2026-07-11 — Competitor lead-pricing benchmark →
  `docs/market-research/lead-pricing-benchmark-2026-07-11.md` (shared is the
  market default: Angi 3-8 buyers, Networx ≤4, CraftJack ~3, Thumbtack 4-5;
  only Networx sells a clearly-priced EXCLUSIVE tier (~1.3-2x shared).
  Blended per-shared-lead: cleaning ~$8-35, landscaping ~$10-55, pest
  ~$18-50, painting ~$15-60, HVAC ~$20-100, roofing ~$30-150+. GATING:
  no vendor publishes a clean per-trade card; CraftJack domain now
  301s to Angi (winding down) — its numbers are stale secondary. Only
  Networx ranges + Networx/Thumbtack models are OFFICIAL; rest [EST]).
- 2026-07-11 — PublicSearch underlying JSON API recon →
  `docs/market-research/publicsearch-api-recon-2026-07-11.md` (**fetcher CAN
  skip DOM**. Transport is NOT REST — results travel over a same-origin
  **WebSocket** `wss://<tenant>.tx.publicsearch.us/ws` as Kofile
  `@kofile/FETCH_DOCUMENTS` JSON (why the earlier "no reachable API host").
  **Empty searchValue = YES**: a date-range-only query with `searchValue:""`
  returned real deed rows (Bexar 830/day, Dallas 1129, Cameron 408) — UI
  refuses, backend doesn't. Params in `payload.query` (recordedDateRange,
  limit, offset, department); response has grantor/grantee arrays, docType,
  recordedDate, instrumentNumber, legalDescription + `meta.numRecords` +
  doc-type facets. Page cap ~250; offset 500 OK. ONE gate: each WS msg needs
  `authToken=window.__ort`, a per-page-load UUID scraped from tenant SSR HTML
  (same-origin, not login/CAPTCHA). Fallback = round-5 DOM scrape).
- 2026-07-11 — Tampa permit + code-enforcement signals →
  `docs/market-research/tampa-permit-311-2026-07-11.md` (**NO-BUILD both legs**
  — Tampa/Hillsborough run Accela SPAs with no record-level open-data mirror:
  City of Tampa CKAN exposes only aggregate KPIs; Hillsborough's self-hosted
  ArcGIS PermitsPlus has the ideal Houston-shaped schema but is FROZEN at Oct
  2023; no public code-enforcement nuisance vocabulary anywhere. Tampa keeps
  FL metro #1 on its other 5 legs, but permits + code/311 are data-request
  legs (FLAG for human), not build-now — Tampa does NOT reach Houston parity
  on these signals via open data).
- 2026-07-11 — Lead-pricing evidence round 2 →
  `docs/market-research/lead-pricing-benchmark-round2-2026-07-11.md` (firmest
  anchor = CraftJack "FairPrice" per-trade card archived on Wayback (2014 +
  2021) w/ real $ (e.g. HVAC install $65→$76res/$114comm; commercial ~1.5x
  residential — relevant to our commercial focus). HomeAdvisor/Angi never
  published a public per-trade card (archives = signup funnels, FLAGGED). 23
  practitioner [ANECDOTE] rows (cleaning/roofing strongest; HVAC + pest
  thinnest; standout $125 Angi EXCLUSIVE pest lead → exclusive multiple >>
  round-1's 1.3-2x). First Look subs: Yelp $150-270/mo, Houzz $499, Nextdoor
  $32-150/ZIP; a $99-249/mo tier sits in-band. Gap: no CURRENT official
  per-trade card exists publicly).
