# Fresh deed sources — Tarrant & Dallas

_Hunt date: 2026-07-10. Read-only public endpoints only. No writes, no logins, no payments made, no CAPTCHA/Turnstile bypass. Anything gated behind registration/payment/CAPTCHA/auth is FLAGGED for human action, not worked around. Findings are UNVERIFIED: exact URLs, sample rows, and the query that produced them are given inline._

_Same playbook and format as the prior Bexar/El Paso hunt. Good news up front: both counties run the same GovOS/Kofile "PublicSearch" platform as Bexar, both are public + no-login, and both were live-queried successfully today._

---

## Tarrant County (Fort Worth)

- **Source:** Tarrant County Clerk (Mary Louise Nicholson) — Official Record Search (GovOS / Kofile "PublicSearch" platform, same vendor as Bexar).
  - **Endpoint (search UI):** https://tarrant.tx.publicsearch.us/
  - **Results deep-link (reproducible — this exact URL returned live rows today):**
    `https://tarrant.tx.publicsearch.us/results?department=RP&recordedDateRange=YYYYMMDD%2CYYYYMMDD&searchType=quickSearch&q=<term>`
    - `department=RP` = **Real Property** (the deed department; party fields are Grantor/Grantee). Confirmed present in the app's `departments` config (`"Department":"RP"`, label "REAL PROPERTY").
    - `recordedDateRange=20260701%2C20260710` = recording-date range filter (comma-separated `from,to`, `YYYYMMDD`) — **identical shape to the Bexar precedent, verified working.** The UI also exposes presets: **Last 24 Hours**, Last 3 Days, 1 Week, 2 Weeks, 1/3/6 Months, 1 Year.
    - Doc-type filtering is exposed as **Document Types** in Advanced Search (a "DOC TYPE" column is returned on every row). As with Bexar, free-text `q="warranty deed"` matches party/legal text, NOT doc type, and returns **No Results** (verified: `q="warranty deed"` over 06/30–07/10 → "returned no results") — so isolate deeds via the Document Types filter, not the `q` param. The bare `docTypes=` querystring did not self-apply; the doc-type filter must be set through the Advanced Search UI.
  - **Fields available** (verified live from the rendered results table):
    - `GRANTOR`, `GRANTEE`
    - `DOC TYPE`
    - **`RECORDED DATE`** (an actual date — the freshness key)
    - `INST NUMBER` (instrument/document number, e.g. `D226126664`)
    - `BOOK/LIBER/PAGE` (shows `OPR/--/--` for e-recorded docs)
    - `LEGAL DESCRIPTION` (subdivision / lot / block / city, e.g. "Subdivision: EAGLES CROSSING, Lot: 13, Block: A")
    - (Instrument Date, consideration, and parcel/GIS fields — Lot/Block/NCB/County Block — are present in the platform's view config as with Bexar; the default results table surfaces the columns above.)
  - **Measured freshness:** system self-certifies **"Certified through 07/06/2026"** (index current to 4 days before today, 2026-07-10). A live query `department=RP, recordedDateRange=2026-07-01..2026-07-10, q=deed` returned a populated Real Property results table with the newest rows dated **7/1/2026** in the sample page. **Days-fresh — exactly what we need.**
  - **Volume (recent recording activity):** the query `recordedDateRange=20260701..20260710 & q=deed` returned **3,852 records** (2020-Present bucket) — i.e. ~3.8k records matching "deed" in the last 10 days. On the first result page alone (~50 rows) the DOC TYPE column showed **17 DEED + 12 DEED OF TRUST** rows, confirming a heavy, dense deed-recording stream. (Free-text "deed" over-counts vs. a true docType filter; treat 3,852 as an upper bound for the "deed" text match, with actual deed/warranty-deed conveyances a large subset.)
  - **Sample rows (shape — live results table, sanitized public record):**
    ```
    GRANTOR | GRANTEE | DOC TYPE | RECORDED DATE | INST NUMBER | BOOK/LIBER/PAGE | LEGAL DESCRIPTION
    BATES TODD C | WESTCLIFF AND BLUEBONNET HOLDINGS LLC | DEED | 7/1/2026 | D226126809 | OPR/--/-- | FORT WORTH, Subdivision: I H BURNEY, Lot: 10
    LOGAN REECE JAMES | LENNAR MORTGAGE LLC | DEED OF TRUST | 7/1/2026 | D226126664 | OPR/--/-- | Subdivision: EAGLES CROSSING, Lot: 13, Block: A
    KIDWILL MIKA RENAE | CREDIT UNION OF TEXAS | DEED OF TRUST | 7/1/2026 | D226126474 | OPR/--/-- | WATAUGA, Subdivision: FOSTER VILLAGE
    ```
  - **Access:** **PUBLIC — no login required** to search, filter by recorded-date range, and view the index results table. Register / Sign In links exist but are optional (cart / certified-copy purchase). No CAPTCHA/Turnstile challenge appeared on the index search; a Google reCAPTCHA site key exists in the app config but gates cart/checkout only (same posture as Bexar).
  - **Backend note:** results render client-side (React); rows are not in the initial HTML and load via a runtime-injected API host that was not statically enumerable from the bundles (matches the Bexar finding). Drive the **public results URL** (date-range querystring) via a headless browser, filtering Document Types to deed types — do not expect a raw JSON endpoint.
  - **FLAG for human:** an "Export all Results" button is present on the results page (public), but bulk-export volume limits / whether reCAPTCHA engages on large repeated automated pulls is not stress-tested. Confirm export limits before building a scaled scraper.

---

## Dallas County (Dallas)

- **Source:** Dallas County Clerk — Official Record Search (GovOS / Kofile "PublicSearch" platform, same vendor as Bexar & Tarrant).
  - **Endpoint (search UI):** https://dallas.tx.publicsearch.us/
  - **Results deep-link (reproducible — this exact URL returned live rows today):**
    `https://dallas.tx.publicsearch.us/results?department=RP&recordedDateRange=YYYYMMDD%2CYYYYMMDD&searchType=quickSearch&q=<term>`
    - `department=RP` = **Real Property** (deed department; Grantor/Grantee parties). Confirmed present in the app config (`"RP"`).
    - `recordedDateRange=20260701%2C20260710` = recording-date range filter (`from,to`, `YYYYMMDD`) — **same shape as Bexar/Tarrant, verified working.** Presets include **Last 24 Hours** through Last 1 Year.
    - Doc-type filtering via **Document Types** in Advanced Search (a "DOC TYPE" column is returned on every row). Dallas exposes an extensive doc-type code list in the app config (AA, AAG, AB, ABC, ABS, ADD, ADDT, ... several hundred codes). Use the Document Types filter to isolate Warranty Deeds — not the free-text `q`.
  - **Fields available** (verified live from the rendered results table):
    - `GRANTOR`, `GRANTEE`
    - `DOC TYPE`
    - **`RECORDED DATE`** (actual date — freshness key)
    - `DOC NUMBER` (e.g. `202600141252`)
    - `BOOK/VOLUME/PAGE`
    - `TOWN` (city, e.g. DALLAS, ROWLETT)
    - `LEGAL DESCRIPTION` (Subdivision / Lot / Block / Township / Survey / Reference)
  - **Measured freshness:** system self-certifies **"Certified through 07/08/2026"** (index current to 2 days before today, 2026-07-10 — the freshest of any county measured so far, Bexar/El Paso included). Live query `department=RP, recordedDateRange=2026-07-01..2026-07-10, q=deed` returned a populated table with rows dated **7/6/2026** in the sample page. **Days-fresh.**
  - **Volume (recent recording activity):** the query `recordedDateRange=20260701..20260710 & q=deed` returned **7,071 records** — ~7k records matching "deed" text in the last 10 days (Dallas is the larger county; volume is roughly double Tarrant's). First result page (~50 rows) DOC TYPE breakdown: **13 WARRANTY DEED + 8 DEED OF TRUST + 2 DEED**, confirming a dense, live warranty-deed stream. (As with Tarrant, "deed" free-text over-counts; treat 7,071 as an upper bound with warranty-deed conveyances a large subset.)
  - **Sample rows (shape — live results table, sanitized public record):**
    ```
    GRANTOR | GRANTEE | DOC TYPE | RECORDED DATE | DOC NUMBER | BOOK/VOL/PAGE | TOWN | LEGAL DESCRIPTION
    2700 MCKINNEY DALLAS PARTNERS LTD | 2700 MCKINNEY DALLAS PROPERTY OWNER LP | WARRANTY DEED | 7/6/2026 | 202600141252 | --/--/-- | DALLAS | Township: DALLAS
    CASHFLOW EMPIRE TRAINING LLC | APEX ASSET MANAGEMENT ASSOCIATES LLC | WARRANTY DEED | 7/6/2026 | 202600141328 | --/--/-- | DALLAS | Subdivision: PEACOCK TERRACE, Lot: 1, Block: 16
    AMERBROOKS LLC | OGUERI OBINNA DEXTER | WARRANTY DEED | 7/6/2026 | 202600141378 | --/--/-- | N/A | Survey: CD MERRELL SUR, Survey 957, Acres PT 0.65
    ```
  - **Access:** **PUBLIC — no login required.** Verified live: no sign-in gate on the index search, and no reCAPTCHA/Turnstile challenge present on the search/results page (`captchaPresent=false, signInRequired=false`). Register/Sign In optional (cart only). Same posture as Bexar/Tarrant.
  - **Backend note:** same as Tarrant — client-side React rendering, runtime-injected API host not statically enumerable. Drive the public results URL via a headless browser.
  - **FLAG for human:** same "Export all Results" bulk-limit caveat as Tarrant/Bexar — confirm export/rate limits before scaling a bulk pull.

---

## Bottom line

- **Tarrant County — USABLE NOW.** County Clerk PublicSearch (https://tarrant.tx.publicsearch.us/, `department=RP`) is public, no-login, has a real `RECORDED DATE` field, supports recorded-date-range filtering (down to "Last 24 Hours"), returns a filterable DOC TYPE column, and is **certified through 07/06/2026 (4 days fresh)**. ~3,852 "deed" records in the last 10 days. Build against the results URL with a rolling `recordedDateRange` querystring in a headless browser, filtering Document Types to deed types. **FLAG:** confirm "Export all Results" volume/reCAPTCHA limits before scaling.
- **Dallas County — USABLE NOW (and freshest of all).** County Clerk PublicSearch (https://dallas.tx.publicsearch.us/, `department=RP`) is public, no-login, no CAPTCHA on search, same GovOS platform and query shape, with `RECORDED DATE` + DOC TYPE columns and recorded-date-range filtering. **Certified through 07/08/2026 (2 days fresh)** — fresher than Bexar (07/07) and better than the CAD-lag baseline by weeks. ~7,071 "deed" records in the last 10 days. Same build approach. **FLAG:** same export/rate-limit caveat.
- **DFW verdict:** Both Tarrant and Dallas can upgrade residential sourcing from CAD-lag (weeks) to **days-fresh (2–4 days)** using the identical GovOS PublicSearch pattern already validated on Bexar. Unlike El Paso, **neither DFW county is CAPTCHA-gated on the index search.** No blockers; the only human sign-off needed is on bulk-export volume/rate limits before building a scaled recurring pull.
