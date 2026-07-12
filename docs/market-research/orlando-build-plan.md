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
| Deeds / transfers | **Tyler "Self Service Web"** `selfservice.or.occompt.com/ssweb/` | **DROPPED** — reCAPTCHA gates the disclaimer itself (see below). Records-request only. | DROP |
| Parcel imagery (enrichment) | **OCPA** `ocpaimages.ocpafl.org` | `GetPIDImage?pid=` (photo) + `GetPIDSketch?pid=…&bldgNum=1` (sketch) — anonymous, no key (OpenClaw round 9). Enriches a sold sheet. | BUILD (later) |

## Deed leg — DROPPED (OpenClaw round 9, 2026-07-12)

The deed/transfer signal is **not buildable within the rails, and is dropped for
Orlando.** The operator had signed off (2026-07-12) on a polite,
disclaimer-accepting, paced, read-only Tyler-ssweb adapter with a HARD STOP at
`/ssweb/checkHuman` — never defeated. Round 9 found that the hold-harmless
disclaimer's **"I Accept" button is itself gated behind a Google reCAPTCHA v2
validated at `/ssweb/checkHuman`** (button loads disabled, enables only on a
`true` response). So `checkHuman` is a **structural, always-on control on the
disclaimer page** — the authorized "accept the public disclaimer" path is
*inseparable* from defeating the bot-check. The agent hard-stopped and never
reached the search form. Therefore:

- **Orlando launches on the five open legs** (permits, code, DBPR buyers,
  RealAuction, FDOR parcels) with **no deed/transfer signal** — in Texas the
  transfer signal is one of several kinds, so this narrows the mix, not blocks
  launch.
- **The only rails-compliant path to deeds is a formal public-records / bulk
  data request to the Orange County Comptroller** (a human action), NOT
  interactive scraping. Flagged for the operator; revisit if such a feed opens.

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
4. **Parcels leg** ✅ (PR #210) — FDOR Cadastral point-query; routes by state.
5. **Permits leg** ✅ (PR #211/#212) — Socrata `ryhf-m453` → `(BLD …)` leads.
   NOTE: Socrata `$where` must be `%20`-encoded (encodeURIComponent), not `+`
   (URLSearchParams) — Orlando's Akamai WAF 403s the `+` form as SQLi.
6. **Code leg** — Socrata `k6e8-nw6w` adapter (Lot/Pool nuisance + free-text).
   Same `%20` encoding rule as permits.
7. **Buyers** — DBPR extract import + enrichment. Round 9 pinned the format:
   quote/comma CSV, no header, 21 cols, county-code = **field 12** (Orange 58),
   files `CONSTRUCTIONLICENSE_1/2/3.csv` + `constr_app.csv`; trade codes HVAC
   `CAC/CMC/RA`, roofing `CCC/RC`, plumbing `CFC/RF/RP`, electrical `ECLB`, fire
   `FRO`. **Landscaping is NOT DBPR** → FDACS lawn-&-ornamental + Sunbiz keyword;
   cleaning/irrigation = Sunbiz keyword only. **Address-only everywhere except
   `constr_app.csv` applicants carry a phone** → Apollo enrichment stage needed.
8. **Tax-deed leg** — RealAuction `orange.realtaxdeed.com` upcoming-sale parcels.
9. ~~Deed leg~~ **DROPPED** (reCAPTCHA-gated disclaimer — see above).
10. **Parcel imagery (later)** — OCPA `GetPIDImage`/`GetPIDSketch` on the sheet.

Each step: re-probe the endpoint live, build the adapter, verify against real
Orange County data, ship its own PR.
