# Tampa Buyer Sourcing — FL Public Rolls of Service Companies

**Date:** 2026-07-11
**Scope:** READ-ONLY research on PUBLIC endpoints only. No logins, payments, registrations, form submissions, or CAPTCHA/Turnstile bypass. Anything requiring a records request or paid extract is FLAGGED, not worked around. Polite request rates; shape/freshness measured, no bulk scraping performed.
**Status:** UNVERIFIED — exact URLs, sample rows, and the queries that produced them are included per source. "Confirmed" = fetched from an official page in this session; "Inferred" = from secondary sources or platform-standard reasoning.

**Headline finding:** **No Florida state or county public roll examined here publishes business EMAIL, and phone is either absent or actively redacted.** Every source is a strong *discovery + firmographic* feed (name / address / county / trade), but **email + phone require a separate enrichment step**. Plan the pipeline as: (1) discover + classify from these rolls → (2) enrich contact data from a vendor/website scrape.

---

## 1. FDACS Pest Control Licensing (state-licensed via Fla. Dept. of Agriculture & Consumer Services)

**Trade covered:** Pest control / lawn & ornamental / structural pest — the ONE landscaping-adjacent trade with a clean, authoritative state roll. FL pest control businesses hold a numbered annual business license (prefix **JB**); applicators/certified operators are individually licensed.

**Endpoints:**
- Current portal (post-2025-04-01): `https://aeslicensing.fdacs.gov`
  - Pest control **company** license report: `https://aeslicensing.fdacs.gov/Reports/PBI---Company-License/`
  - Individual licensees report: `https://aeslicensing.fdacs.gov/Reports/PBI---Individual-Licensees/`
- Legacy company search (still live, "historical only" after 2025-03-28): `https://aessearch.fdacs.gov/companysearchr.asp`
- Consumer landing / how-to-verify: `https://www.fdacs.gov/Business-Services/Pest-Control/Licensing-and-Certification`

**Downloadable vs. search-only:** **Search-only** (confirmed). The company report is a client-side query form (search by beginning-of-company-name and/or beginning-of-license-number, prefix JB); it renders no static roll and did not expose a CSV/Excel/PDF export in the public UI. **No machine-readable data download / bulk roll was found on any public FDACS page.** A full extract would require a **public records request** (contact: Bureau of Licensing & Enforcement, (850) 617-7997, AESCares@FDACS.gov). **FLAGGED — needs human / records request; not attempted.**

**Fields (inferred from the search UI + license-verification guidance; UI is JS-rendered and not fetchable as static HTML):** business/company name, license number (JB…), license status, address, county, license category. **EMAIL: not present. PHONE: not present in the public result set** (FDACS directs consumers to *call the office* to verify details — i.e., contact data is not surfaced online).

**Freshness:** Licenses issued/renewed **annually**; live portal reflects current status. New AES portal effective 2025-04-01; the old `aessearch.fdacs.gov` is frozen historical data.

**Sample rows:** **NOT RETRIEVED — FLAGGED.** The company report requires an interactive form submission against a JS-rendered page; per read-only/no-form-submission scope I did not submit. Reproduce interactively at `https://aeslicensing.fdacs.gov/Reports/PBI---Company-License/` by entering the first letters of a company name (e.g. "Tru", "Ter", "Mas").

**Query that produced findings:** WebSearch "FDACS Florida pest control license search public database business name address"; WebFetch of the Licensing-and-Certification page and the PBI Company License report URL.

---

## 2. DBPR Contractor Rolls (`https://www2.myfloridalicense.com/` — same extracts system as the alcohol leg)

**Downloadable rolls — CONFIRMED, FREE.** DBPR publishes public licensee extracts as quote/comma-delimited **CSV**, refreshed **weekly** (subject to maintenance delay — check the posted date). Master index: `https://www2.myfloridalicense.com/dbpr/sto/file_download/index.html`. Category README/field docs per board under each "Public Records" page; disclaimer at `https://www2.myfloridalicense.com/public-records-read-medisclaimer/`.

**Confirmed extract files relevant to our trades:**
| File | URL | Notes |
|---|---|---|
| Construction licensees | `https://www2.myfloridalicense.com/sto/file_download/extracts/CONSTRUCTIONLICENSE_1.csv` | All CILB-board contractors |
| Construction applicants | `https://www2.myfloridalicense.com/sto/file_download/extracts/constr_app.csv` | Pipeline / pending |
| CILB certified / registered | `.../extracts/cilb_certified.csv`, `.../extracts/cilb_registered.csv` | |
| Landscape Architecture | `https://www2.myfloridalicense.com/sto/file_download/extracts/lic13la.csv` | Board 13 — design pros, NOT lawn-maintenance firms |

**Fields (CONFIRMED, construction & landscape-arch extracts share the layout):** Board Number, Occupation Code, Licensee Name, **Doing Business As Name**, Class Code, Address 1–3, City, State, Zip, **County Code**, License Number, Primary Status, Secondary Status, Original Licensure Date, Effective Date, Expiration Date, Renewal Period, Alternate License Number.
- **EMAIL: NOT included. PHONE: NOT included.** (Confirmed — neither field is in the extract column list.)
- **County filter:** Yes — a **County Code** column is present (two-digit numeric, e.g. 16=Broward; Hillsborough is in this scheme). Filter the CSV locally by county code; there is no server-side county-download parameter (confirmed by absence; per DBPR, call (850) 487-1395 to ask about server-side filtering).

**License-type → trade mapping (KEY for our trades):**
- **Landscaping / lawn maintenance / mowing: NO Florida state license.** There is **no CILB code** for landscape/lawn maintenance. Board 13 "Landscape Architecture" (`lic13la.csv`) covers *design professionals*, not mow-and-blow or install crews — poor proxy for our buyer.
- **Closest DBPR proxy = Irrigation Specialty Contractor**, occupation code **0612 / class IS** (certified, statewide) — install/repair/maintain irrigation systems. This is the best *contractor-side* proxy for larger commercial landscape firms (those that also do irrigation). Confirmed in `https://www2.myfloridalicense.com/about-us/understanding-dbpr-codes/`.
- **Better landscaping proxy is FDACS, not DBPR:** commercial **lawn & ornamental / limited lawn & ornamental pesticide applicators** and **certified pest control (structural)** are the licensed populations that overlap heavily with commercial landscape/lawn-care companies — see §1 (FDACS). Any landscape firm applying chemicals must hold an FDACS credential.
- **Cleaning / janitorial: NO Florida state license** (same as landscaping). DBPR does not cover it. No state proxy exists; discovery must come from county BTR (§3) or Sunbiz name filtering (§4).

**Freshness:** Weekly CSV refresh (confirmed).

**Sample rows:** Extract files are large CSVs; I did not bulk-download (read-only, no bulk scraping). Column layout confirmed above; a spot-fetch of one row is deferred to avoid pulling the full file. Reproduce by requesting the CSV and filtering `County Code` = Hillsborough locally.

**Query that produced findings:** WebSearch "myfloridalicense.com DBPR licensee data download extracts file_download"; WebFetch of the Construction-Industry Public Records page, Landscape Architecture Public Records page, and Understanding-DBPR-Codes page.

---

## 3. Hillsborough County Local Business Tax Receipts (occupational licenses)

**Platform:** TaxSys by Grant Street Group (confirmed — same product across Miami-Dade, Broward, Duval, Pasco, etc.).

**Endpoints:**
- Records-search hub: `https://www.hillstaxfl.gov/records-search/` (hillstax.org redirects here)
- Business Tax public search (TaxSys): `https://hillsborough.county-taxes.com/public/search/business_tax` (path confirmed on sibling counties; landing `https://hillsborough.county-taxes.com/public` confirmed for Hillsborough)
- Single-receipt deep link (public): `https://hillsborough.county-taxes.com/public/business_tax/print_bill?bt_receipt_id=<id>`
- **Separate City of Tampa BTR search (distinct roll):** `https://apps.tampagov.net/Business_Tax_WebApp/Search.aspx` — many Tampa-area firms hold a City BTR in addition to / instead of the county one. Check both.

**Downloadable vs. search-only:** **Search-only (confirmed negative on open data).** The Hillsborough ArcGIS Hub returned **0 business-tax datasets**; no CSV/Excel export on the public TaxSys UI. A bulk roll would need a **public records request (fee likely) — FLAGGED.** (Contrast: Miami-Dade *does* publish a full NAICS-coded Local Business Tax open-data layer — Hillsborough has no equivalent.)

**Fields (inferred from TaxSys standard + Miami-Dade's published schema — the closest confirmed FL reference; Hillsborough live grid returned HTTP 403 to the automated fetcher):** business/DBA name, physical + mailing address, category/classification (Hillsborough uses ordinance-based classes — Retail, Restaurant, Contractor, Handyman, Professional, **Public Service**, etc.; a distinct "Landscaping/Janitorial" label is **not confirmed** — such trades likely fall under Public Service / a trade sub-code), receipt/account number, account status, business start date.
- **EMAIL: not expected / not in reference schema. PHONE: field exists in the underlying data but is RESTRICTED/redacted from public access** (Miami-Dade `PHONE_NO` is non-public). Treat the public roll as **name + address + category only**, NOT a contact source.

**Why it still matters:** This is the ONLY source that captures **unlicensed trades — landscaping/lawn AND cleaning/janitorial** — in a structured, categorized roll. It's the best *county-level discovery directory* for exactly the two trades the state doesn't license, even though it yields no contact data.

**Freshness:** Real-time account status (TaxSys). Receipts expire Sept 30 annually; renewals open July 1; new/prorated receipts issued year-round.

**Gating (FLAGGED):** Public search free, no login for lookups. **Host returns HTTP 403 to non-browser clients** — programmatic scraping is actively blocked; needs a real browser session. No public bulk export (records request only).

**Sample rows:** **NOT RETRIEVED — FLAGGED.** 403 to automated fetcher + form-submission required. Reproduce interactively at `https://hillsborough.county-taxes.com/public/search/business_tax` (search by business name; single receipts viewable via the `print_bill?bt_receipt_id=` deep link if you hold an ID).

**Query that produced findings:** Tax Collector records-search page; TaxSys sibling-county path confirmation; Hillsborough ArcGIS Hub search API (0 hits); Miami-Dade LocalBusinessTax field schema (phone restricted, no email).

---

## 4. Sunbiz (FL Division of Corporations, dos.fl.gov / search.sunbiz.org)

**Use case:** Company-DISCOVERY feed — filter NEW registrations by name keyword ("landscap", "lawn", "pest", "clean").

**Entity name search:**
- `https://search.sunbiz.org/Inquiry/CorporationSearch/ByName` → results at `.../CorporationSearch/SearchResults?inquiryType=EntityName&searchTerm=landscaping`
- **Keyword limitation (important):** the name search is an **alphabetical PREFIX index, not a "contains" substring search.** Searching "landscap" surfaces only names that *start with* "landscap"; "Green Valley Landscaping LLC" would NOT match. → The live search UI is a poor keyword filter for mid-name trade words. Use the bulk file + local substring match instead (below).
- **Detail-page fields (confirmed/inferred):** entity name, document number, status, FEI/EIN, filing date, entity type, principal address, mailing address, **registered agent name + address**, officers/directors + addresses, annual-report history, filed-document images. **EMAIL: none. PHONE: none.**

**Bulk data download — CONFIRMED, FREE:**
- Landing: `https://dos.fl.gov/sunbiz/other-services/data-downloads/`
- Daily: `https://dos.fl.gov/sunbiz/other-services/data-downloads/daily-data/`
- Quarterly: `https://dos.fl.gov/sunbiz/other-services/data-downloads/quarterly-data/`
- Layout spec: `https://dos.sunbiz.org/data-definitions/cor.html`
- **SFTP:** `sftp.floridados.gov` — user `Public`, password `PubAccess1845!` (published public credentials; FREE, no subscription/CD purchase).
- **Daily file = NEW filings added that day** (`doc/cor/yyyymmddc.txt`, fixed-length 1440-char). Corporate-event file `yyyymmddce.txt`. Fictitious names under `doc/fic`. This is the intended, un-CAPTCHA'd new-registration feed.
- **Quarterly** = full active-record snapshot (Jan/Apr/Jul/Oct), 10 files split by last digit, zipped.

**Bulk fields (confirmed from cor.html, ~79 fields):** Corporation Number, Corporation Name, Status, Filing Type, Principal address (1/2/city/state/zip/country), Mailing address, **File Date** (registration date — drives "new" detection), FEI Number, Last Transaction Date, report-year fields, **Registered Agent** (name/type/address/city/state/zip), **Officers 1–6** (title/type/name/address). **EMAIL: NOT present. PHONE: NOT present.**

**Freshness:** Search = live/real-time. Daily bulk = 1-business-day lag (new filings). Quarterly = 4×/year snapshot. → Use quarterly for backfill, daily for the ongoing new-lead feed.

**Gating (FLAGGED):** Bulk = free via public SFTP. Search HTML sits behind **edge/bot protection — `.../ByName` and `.../SearchResults` returned HTTP 403 to the automated fetcher.** Don't scrape the UI; use the daily SFTP file (unblocked, no CAPTCHA).

**Sample rows:** **NOT RETRIEVED — FLAGGED** (search endpoint 403; no-bypass scope). Reproduce via the daily `yyyymmddc.txt` file (parse fixed-width per cor.html) or an interactive browser search "landscaping".

**Query that produced findings:** WebFetch of the DOS data-downloads pages, cor.html layout spec, and search.sunbiz.org (403); confirmation of prefix-index behavior from DOS search guidance.

---

## Recommended Sourcing Stack — RANKED by contact-data quality per trade

**Reality check:** *none* of these four sources yields email, and phone is absent or redacted everywhere. So the ranking below is really **"best discovery + firmographic roll per trade,"** and **every path requires a downstream email/phone enrichment step** (website scrape, or a data vendor keyed on name+address).

### By trade

| Trade | Best public roll | Contact data in roll? | Enrichment needed |
|---|---|---|---|
| **Pest control / lawn & ornamental** | **FDACS** (aeslicensing PBI Company License) — authoritative, licensed population | Name/address/county/license only — **no email/phone** | Yes (email + phone) |
| **Irrigation / larger landscape-install firms** | **DBPR** `CONSTRUCTIONLICENSE_1.csv` filtered to Irrigation Specialty (0612/IS) | Name/DBA/address/**county code** — **no email/phone** | Yes (email + phone) |
| **Landscaping / lawn maintenance (unlicensed)** | **Hillsborough County BTR** (TaxSys) + City of Tampa BTR; secondary: **Sunbiz** name filter | Name/address/category — **no email; phone redacted** | Yes (email + phone) |
| **Cleaning / janitorial (unlicensed)** | **Hillsborough County BTR** + City of Tampa BTR; secondary: **Sunbiz** name filter | Name/address/category — **no email; phone redacted** | Yes (email + phone) |

### Overall ranking (usability of the roll as a pipeline feed)

1. **Sunbiz bulk daily/quarterly (SFTP, FREE)** — *best mechanical feed.* Downloadable, unblocked, documented fixed-width layout, daily NEW-registration file, covers ALL trades by name substring (landscap/lawn/pest/clean) incl. the unlicensed ones. Gives name + principal/mailing/registered-agent addresses + officers. **Discovery-only — needs email/phone enrichment.** Best backbone for "new company" discovery across every trade.
2. **DBPR CSV extracts (FREE, weekly)** — *best for licensed contractor trades.* Clean bulk CSV, county-code column, DBA names. Strong for irrigation/construction-side landscape firms. **No contact fields — needs enrichment.**
3. **FDACS pest control** — *most authoritative for the pest/lawn-chemical population*, and the de-facto proxy for commercial landscape firms that apply chemicals. **But search-only; no download** (bulk = records request, FLAGGED). **No contact fields.** High-value list, higher friction to extract at scale.
4. **Hillsborough County BTR** — *only structured roll for the unlicensed trades (landscaping + janitorial) with category labels*, but **search-only, 403-blocked to bots, phone redacted, no email, no open data.** Best treated as a targeted lookup / records-request source, not a bulk feed.

### Coverage summary
- **Well-covered (authoritative state roll):** pest control / lawn & ornamental (FDACS); irrigation & construction-side landscape (DBPR).
- **Thin / no state license:** **landscaping/lawn maintenance** and **cleaning/janitorial** — only surfaced via county BTR (search-only, no contacts) or Sunbiz name filtering (discovery-only, no contacts). These two trades are the biggest sourcing gap.

### Biggest gap / flag
**The single biggest gap is CONTACT DATA:** no examined FL public roll publishes email, and phone is absent or redacted. The pipeline must budget an enrichment stage (website/whois scrape or a vendor keyed on business name + address) for *every* trade. Secondary flags: (a) FDACS and Hillsborough bulk extracts are **records-request-only** — human action required, not automatable read-only; (b) both Sunbiz search HTML and Hillsborough TaxSys return **HTTP 403 to non-browser clients** — use Sunbiz SFTP bulk (allowed, free) and avoid scraping those UIs.
