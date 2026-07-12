# Orlando / Orange County — Florida metro #1 build plan

**Decision date:** 2026-07-12. Orlando is Greenkeep's first non-Texas metro,
re-picked over Tampa (OpenClaw round 7: Tampa's permit + code legs are dead in
open data; Orlando's are Houston-grade and daily-fresh). This doc is the durable
record of what we're building, in what order, and the guardrails on the one
sensitive leg. Endpoint facts come from OpenClaw rounds 7–8 (see the
`*-2026-07-1*.md` deliverables) and are **UNVERIFIED** — every endpoint gets
re-probed live before it's wired.

## Scope

- **City of Orlando limits first.** Unincorporated Orange County has no public
  record-level permit/code feed today (round 8, task 21) — county-wide is a
  later expansion once `ocgis4.ocfl.net`'s code view is fixed / a county permit
  source appears.
- Market key `orlando` is live in `lib/markets.ts` (bbox = Orange County
  extent, `state: "FL"`). The TX feed slots (LGBS / TABC / Bonfire) are empty by
  design — Orlando sources from the FL adapters below.

## Data legs

Five clean legs + one with a legal snag. Build the clean five first; deeds last.

| Leg | Source | Key facts (round 8, re-probe before wiring) | Status |
|---|---|---|---|
| Permits | City of Orlando Socrata `ryhf-m453` | `estimated_cost` + `plan_review_type` (Commercial/Res), daily, ~2d fresh | BUILD |
| Code enforcement | City of Orlando Socrata `k6e8-nw6w` | `case_type` (Lot/Pool/Housing) + free-text `case_comments`, daily, ~1d fresh | BUILD |
| Contractors (buyers) | DBPR extracts | **Orange `CO_NO` / county code = 58** (not 48); 11.8k rows / 4.6k active; names+addresses; max issue 2026-07-10 | BUILD |
| Tax-deed auctions | RealAuction `orange.realtaxdeed.com` | live, read-only, browser-UA; Aug 2026 = 4 sale dates, parcels w/ bid/address/assessed value | BUILD |
| Parcels / valuation (HCAD stand-in) | FDOR Cadastral 2025 | Mall at Millenia confirmed (JV, `DOR_UC`, `ASMNT_YR` 2025); use `CO_NO=58` (numeric WHERE 400s → spatial-envelope workaround); FDOT parcels token-gated, OCPA API behind Azure APIM | BUILD |
| Deeds / transfers | **Tyler "Self Service Web"** `selfservice.or.occompt.com/ssweb/` | Does NOT port from TX Kofile — different vendor/transport. See guardrails below. | BUILD (guarded) |

## Deed leg — guardrails (operator sign-off 2026-07-12)

The Texas WebSocket deed fetcher does **not** port. Orange County records on
Tyler ssweb: server-rendered HTML + AJAX form-POST over a stateful JSESSIONID,
gated by a per-session hold-harmless disclaimer POST, with a `/ssweb/checkHuman`
bot-detection endpoint present. The operator signed off on building a polite
adapter under these NON-NEGOTIABLE lines:

- **Polite by construction.** Headless-browser / session-cookie flow that
  accepts the public disclaimer as a normal user does. Pace ≥10s between
  requests. Date-windowed pulls only. **Index/metadata only** — never the paid
  certified-copy cart.
- **Hard stop on `/ssweb/checkHuman`.** Do NOT defeat, spoof, or engineer around
  the bot check. If it gates automated access, that is the finding: deeds are
  out and we ship the other five legs. Sign-off covers accepting the public
  disclaimer; it does not cover circumventing a bot control.
- **Stop and back off on 401/403/429.** No bulk scraping. Truthful headers. No
  login / payment / registration.
- First step when built is the live characterization round 8 left open (exact
  `POST /ssweb/searchPost/DOCSEARCH2950S1` body params, pagination, freshness),
  done paced and read-only. If `checkHuman` blocks it there, we stop.
- FL uses a generic "Deed" facet (no WD/SWD split); mortgages, liens, lis
  pendens share the same search + date range; tax deeds are a separate system.

## Build order (one PR per step)

1. **Foundation (this PR):** `orlando` market entry + `state` field + this doc.
2. **Timezone parameterization:** Orlando is Eastern, El Paso is Mountain, the
   rest Central — but `withinSmsSendWindow` (`lib/sms/queue.ts`) and
   `lib/reports/data.ts` hardcode `America/Chicago`. Add a per-market `tz` and
   thread it through the SMS send-window + report day-boundaries. (Also fixes
   the El Paso audit finding.)
3. **Geocode de-Texasification:** the `, TX` fallbacks (`campaigns/build.ts`,
   `buyer-prospecting.ts`, `residential-demand.ts`) should key off the market's
   `state`, and per-state feed fetchers replace TX-only assumptions.
4. **Permits leg** — Socrata `ryhf-m453` adapter → property + teaser.
5. **Code leg** — Socrata `k6e8-nw6w` adapter (Lot/Pool nuisance + free-text).
6. **Parcels leg** — FDOR Cadastral point-query for the parcel/valuation layer.
7. **Buyers** — DBPR `CO_NO=58` contractor import + Apollo enrichment (no FL
   roll publishes email/phone — enrichment stage required, round 8 task 17/20).
8. **Tax-deed leg** — RealAuction `orange.realtaxdeed.com` upcoming-sale parcels.
9. **Deed leg** — Tyler ssweb adapter, under the guardrails above (last).

Each step: re-probe the endpoint live, build the adapter, verify against real
Orange County data, ship its own PR.
