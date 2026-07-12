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

Round 9 — de-risk the Orlando legs Claude has NOT already re-probed while
building in-house. (Permits `ryhf-m453` + FDOR parcels are built and live as of
2026-07-12; the Socrata `$where` must be `%20`-encoded, not `+` — Orlando's
Akamai WAF 403s the `+` form as SQLi. Code enforcement `k6e8-nw6w` is next and
Claude will re-probe it directly, so it is NOT a round-9 task.) Read-only,
public endpoints only; measure shape + freshness (max record date, never a
metadata "modified"), include the exact query/request and sample rows; findings
UNVERIFIED. Everything gated (registration, payment, CAPTCHA, bot-check) gets
FLAGGED, never worked around.

### 22. Tyler ssweb deed request-shape characterization — de-risk the hardest leg

Round 8 verified Orange County records deeds on **Tyler "Self Service Web"**
(`selfservice.or.occompt.com/ssweb/`, HTML form-POST over a stateful
JSESSIONID, per-session hold-harmless disclaimer, a `/ssweb/checkHuman`
bot-check). The operator has signed off on building a **polite,
disclaimer-accepting, ≥10s-paced, read-only** adapter — and on a **HARD STOP at
`/ssweb/checkHuman` (never defeated, spoofed, or worked around)**. Characterize
the request shape so the adapter is buildable, staying inside those rails:

- The exact **`POST /ssweb/searchPost/DOCSEARCH2950S1` body params** — the field
  names for the recorded-date range and the doc-type filter (capture from ONE
  paced, human-like form submission after accepting the public disclaimer).
- **Pagination mechanics**: how pages 2..N are requested (form re-POST? a GET
  with an offset/page param?), and the page size.
- **Freshness**: the true max recorded date over the most recent business days
  (a `Deed`-facet, date-range query).
- Whether the **document-detail page** (`/ssweb/document/…`) exposes the deed
  **sub-type** (warranty vs quitclaim) and the full legal description, for
  owner/property matching.
- If `checkHuman` triggers under this paced, disclaimer-accepting access: STOP,
  and report exactly what tripped it — that is the finding.

Deliverable: `docs/market-research/orange-ssweb-deed-shape-<date>.md` with the
copy-pasteable request(s). If the leg proves un-buildable within the rails, say
so plainly so Claude ships the other five legs and drops deeds.

### 23. Florida buyer-roll extract formats — de-risk "who do we sell to"

Before Claude builds the FL buyer import (the DBPR contractor + Sunbiz path
round 7/8 named), pin down the machine-readable extract formats:

- **DBPR contractor extract** (`CONSTRUCTIONLICENSE_1.csv` and siblings under
  `www2.myfloridalicense.com/sto/file_download/extracts/`): exact columns, the
  county-code column (Orange = **58**, confirmed), and **which license-type
  codes map to our trades** — landscaping is NOT state-licensed in FL, so answer
  the landscaping-proxy question explicitly (lawn-&-ornamental via FDACS? tree
  work? or unlicensed-by-name only). Irrigation, electrical, HVAC/AC, roofing,
  plumbing, fire — map each to its DBPR board/license type.
- **FDACS** pest + lawn-&-ornamental roll: machine-readable? columns, county
  filter, freshness.
- **Sunbiz** new-registration bulk file (SFTP or the daily download): the
  fixed-width/CSV layout, the fields that carry business name + address + a
  filing date, and how to keyword-filter to our trades.
- For each: does it publish **email or phone**, or is a downstream enrichment
  stage required (round 7 said none do — confirm per source).

Deliverable: `docs/market-research/fl-buyer-rolls-<date>.md` — per-source column
list + trade mapping + freshness, ranked by contact-data quality.

### 24. Unincorporated Orange re-probe + OCPA imagery — county-wide scope

Round 8 found the county code-enforcement view (`ocgis4.ocfl.net`, "EPD
Violation All") had the right schema but a broken public `/query` (500/timeout).
Re-probe:

- Is `ocgis4.ocfl.net` EPD-Violation `/query` back up? If so: shape + **freshness
  (max inspection/case date)** + comm/res discriminator, same bar as the City
  `k6e8-nw6w` feed. This decides whether county-wide code enforcement is a BUILD.
- Any **county building-permit** record-level feed (re-check the Property
  Appraiser + county GIS hub for anything Accela-free).
- OCPA parcel **image endpoints** (`ocpaimages.ocpafl.org/api/Image/GetPIDImage?pid=`
  and the sketch/photo routes) — are they callable read-only? These would enrich
  a sold sheet with an official parcel sketch.

Deliverable: `docs/market-research/orange-unincorporated-r2-<date>.md`.

_Priority: 22 first (the deed leg is the last and hardest, and the go/no-go
gates the whole signal mix), then 23 (buyers gate launch — can't sell without
companies), then 24 (county-wide scope)._

<!-- Round-8 briefs preserved below for reference; all delivered.

Round 8 — Orlando / Orange County pre-build verification. Round 7 RE-PICKED
Orlando as Florida metro #1 (Tampa's permit + code legs are dead in open data;
Orlando's are both Houston-grade and daily-fresh). Before the build starts,
close the three unknowns round 7 left open. Read-only public endpoints only;
measure shape + freshness (max record date, never a metadata "modified"),
include the exact query and sample rows; findings are UNVERIFIED.

### 19. Orange County deed-recording transport — does the round-6/7 fetcher port?

**Highest priority — this decides whether the verified WebSocket transport
ports to Florida at all.** Rounds 6–7 proved the deed transport against
**Texas** PublicSearch/Kofile tenants (`<tenant>.tx.publicsearch.us`, signed
`authToken`+`authToken.sig` cookie pair, empty-searchValue + date-range query).
Florida counties often record on a DIFFERENT clerk-of-court system. Answer:

- Does the **Orange County (FL) Comptroller / Clerk of Court** official-records
  search run on PublicSearch/Kofile (look for a `*.fl.publicsearch.us` or
  Kofile-branded tenant), or a different platform (e.g. a county-hosted
  official-records portal)? Identify the actual live search host.
- If PublicSearch: confirm the SAME handshake ports (SSR `__ort` + signed
  cookie pair, WS frames, empty-searchValue date-range query returns rows) —
  one live sample. If a DIFFERENT system: characterize its record-level
  transport (REST? SOAP? SPA-only?), whether deeds are pullable read-only with
  a date filter, daily volume, and freshness.
- Same for the deed-adjacent signals we key on (mortgages, lis pendens,
  tax deeds) if visible in the same system.

Deliverable: `docs/market-research/orange-deed-transport-<date>.md` — the
verdict is "fetcher PORTS unchanged" vs "Orange needs its own deed adapter (here
is the source + transport)." Flag terms-of-use / throttling before any sustained
pull, same as round 7.

### 20. Orlando statewide-legs verification — do the assumed feeds cover Orange?

Round 7 *assumed* the statewide legs (DBPR contractor rolls, FDOR/FL Dept of
Revenue, RealAuction tax-deed) "apply unchanged" to Orlando but did not verify
they actually return Orange County records with usable shape. Verify each:

- **DBPR** contractor/business rolls: filter to Orange County (county-code
  column from task 17), confirm nonzero rows, business name/address fields,
  freshness.
- **RealAuction** (FL tax-deed/foreclosure auctions): is Orange County on
  RealAuction, what's the live host/slug, does it expose upcoming-sale parcels
  read-only, freshness.
- **FDOR** or the Orange County Property Appraiser (`ocpafl.org`) for the
  parcel/valuation layer that stands in for Houston's HCAD — record-level query,
  shape, freshness.

Deliverable: `docs/market-research/orlando-statewide-legs-<date>.md` — per-leg
BUILD / NO-BUILD with the query + sample rows + max record date.

### 21. Unincorporated Orange County sourcing — the coverage gap round 7 named

Round 7's permit/code BUILD (`ryhf-m453`, `k6e8-nw6w`) is **City of Orlando
limits only**; unincorporated Orange County (the majority of the metro's
commercial footprint) needs its own source. Round 7 noted `ocgis1.ocfl.net` did
not respond — re-probe:

- Orange County's own open-data / ArcGIS / Socrata for a **county** building-
  permit and code-enforcement feed (record-level, valuation-bearing, fresh).
  Try the Property Appraiser, the county GIS hub, and any Socrata under
  `ocfl.net` / `orangecountyfl.net`.
- If a county permit/code feed exists: shape + freshness + comm/res
  discriminator, same bar as the City feed. If not: say so plainly (City-only
  launch, county as later expansion) so the build scopes correctly.

Deliverable: `docs/market-research/orange-county-unincorporated-<date>.md`.

_Priority: 19 first (it decides whether the deed fetcher ports — the single
biggest Texas→Florida assumption), then 20 (verify the legs we assumed), then
21 (scope city-only vs county-wide)._

-->

<!-- Round-7 briefs preserved below for reference; all delivered.

### 16. PublicSearch WebSocket pre-build verification — no-browser feasibility

Round 6 found the real transport: same-origin WebSocket carrying Kofile
`@kofile/FETCH_DOCUMENTS` frames, gated only by an `authToken` (`window.__ort`,
a per-page-load UUID in the tenant's SSR HTML). Before we build the fetcher,
prove the whole handshake works from a PLAIN HTTP CLIENT (no browser):

- GET each tenant's page with a generic HTTP client; confirm `__ort` is
  extractable from the raw HTML (regex + one sample per tenant, all 7).
- Open the `wss://<tenant>.tx.publicsearch.us/ws` socket from a non-browser
  client: which headers matter (Origin? User-Agent? cookies?), does the
  server enforce an Origin check, and does the round-6 date-range query
  (`searchValue:""`) still return rows this way?
- Token lifetime: does one `__ort` survive multiple queries / minutes /
  pagination to offset 500? What error shape comes back when it expires?
- Note any per-IP throttling on the socket at ≥10s pacing (report, don't
  push through).

Deliverable: `docs/market-research/publicsearch-ws-verify-<date>.md` with
copy-pasteable request/handshake examples per tenant. This is the last recon
before the 7-county deed fetcher gets built in-house.

### 17. Tampa buyer-side prospect sourcing — who do we SELL to in Florida?

Every Texas metro launch leaned on our existing prospect-company pipeline;
Florida needs its own supply of service companies (with contactable emails/
phones) before Tampa outreach can start. Map the public rolls:

- **FDACS pest control licensing** (Florida pest is state-licensed):
  machine-readable roll? Business name/address/county fields, download vs
  search-only, freshness.
- **DBPR contractor rolls** (the same extracts system as the alcohol leg):
  which license types map to our trades (landscaping has no FL state
  license — what's the closest proxy? irrigation? commercial applicators?),
  county filters, contact fields present (email? phone?).
- **Hillsborough local business tax receipts** (occupational licenses):
  public roll with NAICS-ish classifications? That's often the best
  landscaping/cleaning directory a county has.
- **Sunbiz (FL Division of Corporations)**: bulk/daily corporate filings —
  can we filter new registrations by name keyword ("landscap", "lawn",
  "pest", "clean") as a company-discovery feed?
- For each source: sample 3 rows, note whether email/phone appear, and
  FLAG anything requiring a records request or paid extract.

Deliverable: `docs/market-research/tampa-buyer-sourcing-<date>.md` with a
recommended stack ranked by contact-data quality.

### 18. Florida permit/311 rescue sweep — Pinellas, Orlando, Broward, Jax

Round 6's Tampa permit/311 legs came back NO-BUILD on open data (Accela
SPAs, frozen mirrors). Before we accept a permits-less Tampa launch, sweep
the neighbors — same shape as the round-4 Texas permit sweep:

- **Pinellas County / St. Petersburg / Clearwater** (Tampa Bay's other
  half): if Pinellas has Houston-grade open permits + code enforcement,
  the Tampa-bay MARKET gets its permit leg from across the bay — check
  whether our proposed bbox already covers it.
- **Orlando / Orange County**, **Broward / Fort Lauderdale**,
  **Jacksonville / Duval**: permits (valuation field, commercial
  discriminator, cadence) + code-enforcement vocabulary. If one of these
  clearly beats Tampa on the two missing legs while matching the other
  five (DBPR/FDOR/RealAuction are statewide), say so — it's a case for
  re-picking FL metro #1, and the memo should make the call explicitly.

Deliverable: `docs/market-research/fl-permit-311-sweep-<date>.md` with a
build-order recommendation and a KEEP-TAMPA / RE-PICK verdict.

_Priority: 16 first (last blocker before the deed-fetcher build), then 17
(Tampa can't launch without buyers to sell to), then 18._

-->

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
- 2026-07-11 — PublicSearch WebSocket no-browser verification →
  `docs/market-research/publicsearch-ws-verify-2026-07-11.md` (**no-browser
  fetcher FEASIBLE** — plain Python websocket-client pulled live RP rows from
  all 7 tenants, no headless needed. Round-6 correction: the gate is NOT
  `__ort` alone but the **signed cookie pair `authToken` + `authToken.sig`**
  set by the SSR homepage GET — keep a cookie jar, forward both to the socket,
  and each frame's authToken must match. Server does NOT enforce Origin; any
  UA accepted. Socket drops after ~90s idle → 30s PING keepalive. Token/session
  survives pagination to offset ≥500-1000. No 401/403/429 at ≥10s pacing.
  **FLAG for human before any sustained pull: county terms-of-use + high-volume
  throttling untested** — deliberately light probe).
- 2026-07-11 — Tampa buyer-side prospect sourcing →
  `docs/market-research/tampa-buyer-sourcing-2026-07-11.md` (best mechanical
  feed = **Sunbiz bulk SFTP** (free public creds, daily new-registration
  fixed-width file, every trade by name substring incl. unlicensed); DBPR
  weekly CSVs #2 (county-code col); FDACS authoritative for pest/lawn-&-
  ornamental; Hillsborough/City BTR + Sunbiz for unlicensed landscaping-
  maintenance + janitorial. **CRITICAL: NO public FL roll publishes email;
  phone absent/redacted** — pipeline MUST budget a downstream email/phone
  enrichment stage. FDACS + Hillsborough bulk are records-request (FLAG);
  Sunbiz/Hillsborough HTML 403 non-browser → use Sunbiz SFTP, not scrape).
- 2026-07-11 — Florida permit/311 rescue sweep (Pinellas/Orlando/Broward/Jax)
  → `docs/market-research/fl-permit-311-sweep-2026-07-11.md` (**VERDICT:
  RE-PICK — Orlando / Orange County as FL metro #1.** Orange is DOUBLE BUILD:
  Socrata permits `ryhf-m453` (estimated_cost + comm/res, daily, max
  2026-07-10) + code `k6e8-nw6w` (nuisance buckets, daily, max 2026-07-11) —
  Houston-grade both legs; statewide legs (DBPR/FDOR/RealAuction) still apply.
  Pinellas does NOT rescue Tampa Bay (permits Accela, only code layer frozen
  2022; note Tampa bbox already covers Pinellas but no data behind it).
  Broward permits stale + ESTCOST 100% empty; Duval firewalled — both
  NO-BUILD. Decision for operator: re-pick Orlando, or keep Tampa and accept
  a permits-less launch).
- 2026-07-12 — Orange County (FL) deed-recording transport →
  `docs/market-research/orange-deed-transport-2026-07-12.md` (**VERDICT: TX
  fetcher does NOT port — Orange needs its own deed adapter.** Orange County
  Comptroller runs **Tyler "Self Service Web"** at `selfservice.or.occompt.com/
  ssweb/`, NOT PublicSearch/Kofile (no `__ort`, no signed-cookie WS). Transport
  = server-rendered HTML + AJAX form-POST over a stateful JSESSIONID:
  disclaimer-accept → `POST /ssweb/searchPost/DOCSEARCH2950S1`; a date-range-
  only query returned rows live (07/10/2026 = 20 pages; sample Doc# 20260385183
  Mortgage). FL uses a generic "Deed" facet (360/day; no WD/SWD split, differs
  from TX); Mortgage/Lien/Lis Pendens in same search; tax deeds separate.
  **STRONG FLAG for human: a `/ssweb/checkHuman` bot endpoint + per-session
  hold-harmless disclaimer POST + unknown rate limits — legal/ToS sign-off
  needed before building.**).
- 2026-07-12 — Orlando statewide-legs verification →
  `docs/market-research/orlando-statewide-legs-2026-07-12.md` (**all 3 legs
  GO for Orange.** DBPR contractors: Orange county code = **58** (NOT 48 — the
  Hillsborough-style guess was wrong), 11,820 rows / 4,646 active, names+
  addresses, max issue 2026-07-10. RealAuction `orange.realtaxdeed.com` live
  (needs browser UA, read-only, no login) — Aug 2026 has 4 sale dates, 08/06
  preview = 25 parcels w/ Case#/Parcel/Bid/Address/Assessed Value. Parcels:
  FDOR Cadastral 2025 (services9.arcgis.com) — Mall at Millenia point-query
  confirmed (JV $349M, DOR_UC 015, ASMNT_YR 2025), CO_NO 58. Flags: numeric
  CO_NO WHERE 400s → spatial-envelope workaround; FDOT parcels token-gated
  (use FDOR); OCPA API behind Azure APIM key).
- 2026-07-12 — Unincorporated Orange County sourcing →
  `docs/market-research/orange-county-unincorporated-2026-07-12.md` (**county
  permits NO-BUILD** — no public record-level valuation-bearing feed (permit
  lookup is an external Accela-style portal); **county code enforcement
  NO-BUILD now, re-probe later** — the right schema EXISTS on the live
  successor `ocgis4.ocfl.net` ("EPD Violation All": type/status/inspection
  date/address/parcel/coords) but its public `/query` is broken today
  (where=1=1 times out, objectIds=1 → HTTP 500; control query on a static
  layer worked, so it's the CE view not the server) — freshness UNVERIFIED,
  no row extractable. Round-7's `ocgis1.ocfl.net` is dead → successor is
  `ocgis4`. **Launch scope = CITY-OF-ORLANDO-ONLY**, unincorporated county as
  later expansion; re-probe the ocgis4 CE /query to promote it to BUILD).
