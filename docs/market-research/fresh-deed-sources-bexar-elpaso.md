# Fresh deed sources — Bexar & El Paso

_Hunt date: 2026-07-10. Read-only public endpoints only. No writes, no logins, no payments made. Anything gated behind registration/payment/CAPTCHA is FLAGGED for human action, not bypassed._

---

## Bexar County (San Antonio)

- **Source:** Bexar County Clerk — Official Records Search (GovOS / Kofile "PublicSearch" platform)
  - **Endpoint (search UI):** https://bexar.tx.publicsearch.us/
  - **Results deep-link (reproducible):** `https://bexar.tx.publicsearch.us/results?department=RP&recordedDateRange=YYYYMMDD%2CYYYYMMDD&searchType=quickSearch&q=<term>`
    - `department=RP` = **Land Records** (the deed department; party fields are grantor/grantee).
    - `recordedDateRange=20260701%2C20260710` = recording-date range filter (comma-separated `from,to`, `YYYYMMDD`). The UI also exposes presets: **Last 24 Hours**, Last 3 Days, 1 Week, 2 Weeks, 1/3/6 Months, 1 Year.
    - Advanced Search supports filtering by `docTypes` (Document Types) instead of free text — this is the correct way to isolate Warranty Deeds. (Free-text `q="warranty deed"` matches party/legal text, NOT doc type, and returns nothing — filter by docType.)
  - **Fields available** (verified from the live results table + the app's embedded config for the RP/Land Records department):
    - `grantor`, `grantee` (owner/new owner)
    - `docType` (Doc Type)
    - **`recordedDate`** ("Recorded Date" — an actual date, this is the freshness key)
    - `instrumentDate` (Instrument Date)
    - `docNumber` (Document Number)
    - `book` / `volume` / `page`
    - `legalDescription`
    - `propertyAddress`
    - `consideration` (sale price, when present)
    - `pageCount`, `docStatus`, `marginalReferences`
    - GIS-style parcel fields also exposed in view config: `lot`, `block`, `NCB`, `County Block`
  - **Measured freshness:** system self-certifies **"Certified through 07/07/2026"** (i.e. index is current to 3 days before today, 2026-07-10). A live query `department=RP, recordedDateRange=2026-07-01..2026-07-10` returned a populated Land Records results table (4,761 records in the 2020-Present bucket for that query, 10+ result pages). This is days-fresh — exactly what we need.
  - **Sample rows (shape — live results table columns):**
    ```
    Grantor | Grantee | Doc Type | Recorded Date | Doc Number | Book/Volume/Page
    <grantor name> | <grantee name> | WARRANTY DEED | 07/07/2026 | 20260139xxx | --/--/--
    <grantor name> | <grantee name> | DEED | 07/06/2026 | 20260139xxx | --/--/--
    ```
    (Columns confirmed live: Grantor, Grantee, Doc Type, Recorded Date, Doc Number, Book/Volume/Page. Individual cell values not transcribed here because the sandbox snapshot renderer stripped table-cell text; shape and freshness are confirmed.)
  - **Access:** **PUBLIC — no login required** to search, filter by recorded-date range, and view the index results table. Register/Sign In links exist but are optional (for cart/certified-copy purchase). There is a Google reCAPTCHA site key present in the app config, but it gates the cart/checkout/express-purchase flow, not the index search — the index search rendered and returned results without any challenge.
  - **Bulk note:** an **"Export all Results"** button is present on the results page (public). Feasibility of bulk export at scale not yet stress-tested; the reCAPTCHA may engage on large/repeated automated pulls — FLAG for a human to confirm export volume limits before building a scraper.
  - **Backend note:** the API host is injected at runtime and was not reachable/enumerable from our infra, so scraping should drive the public results URL (date-range querystring) via a headless browser rather than a raw JSON endpoint.

---

## El Paso County

- **Source:** El Paso County Clerk — Official Public Records Search (in-house ASP.NET MVC app)
  - **Endpoint (search UI):** https://apps.epcountytx.gov/publicrecords/OfficialPublicRecords
  - **Search POST target:** `POST /publicrecords/OfficialPublicRecords/OfficialPublicRecordsSearch`
  - **Fields available** (form contract, verified live):
    - Search inputs: `DeedName` (grantor/grantee, "Last First"), `Style` (document type — dropdown of 200+ codes incl. **Warranty Deed, Quitclaim Deed, Administrators Deed, Deed in Lieu**, etc.), `InstrumentNumber`, `Subdivision`, `Book`/`Page`, `Lot`/`Block`/`Unit`/`Tract`, and a recording-date range: **`InstrumentDateFrom` / `InstrumentDateTo`** (mm/dd/yyyy).
    - A date-range-only search is valid (`at-least-one-required` includes the date fields).
  - **Measured freshness:** **UNVERIFIED — blocked.** A live read-only date-range POST (2026-07-01..2026-07-10) returned **zero result rows** and a hard **Cloudflare Turnstile** challenge: response contained `<div class="cf-turnstile" data-sitekey="0x4AAAAAADp3_X3hNCTm5Hn1...">` and the error `"We could not verify that you are human"` (`id="turnstileErrorMessage"`). The date-range capability exists, but results cannot be retrieved without solving Turnstile in a real browser session.
  - **Sample rows:** none obtainable — Turnstile blocked the result set. Result table columns could not be captured.
  - **Access:** **PUBLIC but CAPTCHA-GATED (FLAG).** No login/payment required, but every search submission is protected by Cloudflare Turnstile, which blocks headless/programmatic queries. **FLAG for human:** either (a) run this through a real browser (Turnstile solves invisibly for genuine human sessions — a browser-based/attended scrape may work), or (b) evaluate a Turnstile-capable browser-automation path. Do not attempt to bypass the challenge server-side.
  - **Alternatives checked & rejected for El Paso:**
    - **QuickLink** (https://kofilequicklinks.com/ElPaso/) — historic deed index books only, **1874–1963**. Not fresh. Skip.
    - **EPC DPW / El Paso County GIS Open Data** (https://opendata-elpasoco.hub.arcgis.com/, https://www.epc-dpwdata.com/) — updated **quarterly**. Not days-fresh. Skip.
    - **EPCAD (appraisal district)** parcel/deed data — this is the known-bad stale-string CAD source; TaxNetUSA mirror shows appraisal data current only to **Mar 11, 2026**. Confirmed unusable, matches the briefing.

---

## Bottom line

- **Bexar County — USABLE NOW.** The County Clerk's PublicSearch (https://bexar.tx.publicsearch.us/, `department=RP`) is public, no-login, has a real `recordedDate` field, supports recorded-date-range filtering (down to "Last 24 Hours"), and is certified current to **07/07/2026** (3 days fresh). Build the switch-target detector against this by driving the results URL with a rolling recorded-date-range querystring in a headless browser and filtering `docTypes` to deed types. **FLAG for human:** confirm the "Export all Results" volume/reCAPTCHA limits before scaling a bulk pull.
- **El Paso County — BLOCKED on CAPTCHA.** The Clerk's official search (https://apps.epcountytx.gov/publicrecords/OfficialPublicRecords) is the only days-fresh option (it has the right fields incl. `InstrumentDateFrom/To` and a Warranty-Deed doc-type filter), but every query is gated by **Cloudflare Turnstile**. Freshness could not be measured. The CAD (stale) and GIS open-data (quarterly) alternatives are both too stale. **FLAG for human decision:** approve an attended/real-browser Turnstile path for the El Paso Clerk search, or accept that El Paso stays blocked. No public non-CAPTCHA fresh-deed endpoint for El Paso was found.
