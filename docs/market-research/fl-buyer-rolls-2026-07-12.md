# FL Buyer Rolls — Machine-Readable Extract Formats (Orange County FL)

**Date:** 2026-07-12
**Scope:** Read-only research on PUBLIC endpoints only. No logins, payments, registrations, form submissions, or CAPTCHA/Turnstile bypass. Anything requiring a records request or paid extract is FLAGGED, not worked around. Polite single-request probes only — shape/columns/freshness measured, no bulk scraping.
**Verification status:** UNVERIFIED research. All URLs, column lists, sample rows, and queries are recorded below. Freshness = max record date observed in-file, not site metadata. Web-search/web-fetch results were treated as untrusted and cross-checked against the actual government files where possible.

**Task context:** Orange County FL. DBPR county code = **58** (confirmed against the live construction extract — Orlando/Apopka/Winter Park rows all carry `58`).

---

## Source 1 — DBPR Contractor Extract (Construction Industry Licensing Board / CILB)

**Extract host dir:** `https://www2.myfloridalicense.com/sto/file_download/extracts/`
The directory itself does NOT list (any dir path returns the WordPress homepage, 198,847 bytes). Files must be requested by exact name. The canonical file index is the Construction Industry Public Records page:
`https://www2.myfloridalicense.com/construction-industry/public-records/`

**Format:** ASCII text, **quote/comma-delimited CSV, NO header row** (per DBPR ReadMe: "formatted as ASCII text, quote/comma delimited," §119.01(2)(b) F.S.).

### Extract files confirmed to exist (probed, HTTP 200, real payload)
| File | URL | Size | Content |
|---|---|---|---|
| `CONSTRUCTIONLICENSE_1.csv` | `.../extracts//CONSTRUCTIONLICENSE_1.csv` (note double slash on the official link) | ~48.2 MB | Main licensee roll (active/inactive/vol-inactive) |
| `CONSTRUCTIONLICENSE_2.csv` | `.../extracts/CONSTRUCTIONLICENSE_2.csv` | ~14.7 MB | Continuation |
| `CONSTRUCTIONLICENSE_3.csv` | `.../extracts/CONSTRUCTIONLICENSE_3.csv` | ~13.8 MB | Continuation |
| `constr_app.csv` | `.../extracts/constr_app.csv` | ~14.9 MB | **Construction + Electrical Applicants** (different layout — HAS PHONE) |
| `cilb_certified.csv` | `.../extracts/cilb_certified.csv` | (CE file) | Continuing-education completions |
| `cilb_registered.csv` | `.../extracts/cilb_registered.csv` | (CE file) | Continuing-education completions |
| `swimpool_exam.csv` | `.../extracts/swimpool_exam.csv` | (small) | Swimming-pool examiners (HAS EMAIL + PHONE) |

`ELECTRICALLICENSE_1.csv` as a standalone name does NOT exist (returns homepage). Electrical certs live inside the CONSTRUCTIONLICENSE files under Electrical Contractors' Licensing Board occupation codes (see mapping). `COSMETOLOGYLICENSE_1.csv` exists (~73 MB) but is a different board (DPR cosmetology), not construction.

### Column layout — CONSTRUCTIONLICENSE_*.csv (21 documented columns; file emits 22 positional fields)
Per official "File Layout Information" on the public-records page, in order:
1. Board Number
2. Occupation Code
3. Licensee Name (person, "LAST, FIRST M")
4. Doing Business As Name
5. Class Code
6. Address Line 1
7. Address Line 2
8. Address Line 3
9. City
10. State
11. Zip
12. **County Code**  ← Orange = `58`
13. License Number
14. Primary Status (`A`=active, `I`=inactive, etc.)
15. Secondary Status
16. Original Licensure Date (MM/DD/YYYY)
17. Effective Date
18. Expiration Date
19. Blank
20. Renewal Period
21. Alternate Lic# (the full prefixed license, e.g. `CBC027068`)
(File emits a trailing 22nd empty field.)

**County-code column = field index 12 (0-based idx 11).** Filter `row[11] == "58"` for Orange.

### 3 Orange County (58) sample rows — from CONSTRUCTIONLICENSE_1.csv
```
"06","CBC","HUTTON, MARK H","HUTTON ENTERPRISES INC","","7009 DR PHILLIPS BLVD","SUITE 250","","ORLANDO","FL","32819","58","0027068","C","A","10/31/1983","06/16/2000","08/31/2028","","","CBC027068",""
"06","CBC","MAJORS, STEPHEN G","MAJOR FLORIDA ENTERPRISES, LLC","","9920 MARSH PONTE DRIVE","","","ORLANDO","FL","32832","58","0027113","C","A","10/31/1983","03/14/2023","08/31/2026","","","CBC027113",""
"06","CBC","CARPENTER, MICHAEL R","C & M CARPENTER CONST CO INC","","1513 ROYAL CIRCLE","","","APOPKA","FL","32703","58","0027131","C","A","10/31/1983","06/22/2000","08/31/2028","","","CBC027131",""
```
Orange (58) row count in CONSTRUCTIONLICENSE_1.csv alone: **11,820**.

### DBPR occupation/license-type codes → our trades
Distinct occupation codes observed in CONSTRUCTIONLICENSE_1.csv (with counts), mapped:

| Trade (ours) | DBPR code(s) | Board/meaning |
|---|---|---|
| **HVAC / AC** | `CAC` (Certified Air Conditioning, 12,285), `RA` (Registered A/C, 322), `CMC` (Certified Mechanical, 2,754), `RM` (Registered Mechanical, 83) | CILB — A/C + mechanical |
| **Roofing** | `CCC` (Certified Roofing, 11,205), `RC` (Registered Roofing, 515) | CILB — roofing |
| **Plumbing** | `CFC` (Certified Plumbing, 9,227), `RF` (Registered Plumbing, 581), `RP` (Registered Plumbing, 476) | CILB — plumbing |
| **Electrical** | `CVC` (513), `RX`(215), `RV`, `EC/ER` electrical certs | Electrical Contractors' Licensing Board (ECLB) — carried inside this file |
| **Fire protection** | `FRO` (Fire sprinkler contractor, 18,949), `CFC` overlaps plumbing (careful), fire-alarm under `RF`/`EF` | State Fire Marshal / CILB — `FRO` is the fire-protection value |
| **Irrigation** | `CUC` (Certified Underground Utility & Excavation, 2,985) is the closest state license; there is NO standalone "irrigation contractor" state license in FL | see landscaping note |
| Other (general) | `QB` Qualified Business (126,339), `CGC` Certified General (38,666), `CBC` Certified Building (19,593), `CRC` Certified Residential (8,493), `CPC` Certified Pool/Spa (4,586), `SCC` Solar (3,804), `CSC`, `CRS1`, etc. | CILB umbrella |

**Contact fields (main licensee file):** Address / City / State / Zip only. **NO email, NO phone.** → downstream enrichment REQUIRED for the licensee roll.

**Contact fields (APPLICANTS file `constr_app.csv`):** DOES carry a **Phone Number** column. Layout (15 positional fields): Occupation Number, Occupation Description, First Name, Second Name, Last Name, Suffix, Address 1, Address 2, Address 3, City, State, Zip, **County Code**, **Phone Number**, (trailing blank). Sample (county 58, Winter Park):
```
"0604","Certified Plumbing Contractor","MARK","","WOEHRLE","","3063 CORAL VINE LANE","","","WINTER PARK","FL","32792","58","407-717-3351",""
```
So DBPR *does* publish phone — but only for **applicants (new/pending license seekers)**, not the established-licensee roll. This is a strong signal for freshly-forming contractors.

### Landscaping-proxy answer (explicit)
**Landscaping is NOT state-licensed in FL** — there is no DBPR landscaping license and no landscaping occupation code. The workable proxy is **FDACS lawn-&-ornamental pest control (Ch. 482)** — see Source 2. Within DBPR the only adjacent codes are `CUC` (underground utility/excavation, i.e. site/irrigation-line work) — usable as a *weak* irrigation proxy, not landscaping. Verdict: **landscaping proxy = FDACS lawn-&-ornamental (Ch. 482), NOT DBPR.** Irrigation is likewise effectively unlicensed by name; best DBPR proxy is `CUC`, else fall back to Sunbiz keyword "irrigation". **Cleaning/janitorial:** same as landscaping — NOT state-licensed anywhere in FL; DBPR/FDACS carry nothing. Only proxy is Sunbiz keyword ("clean","janitor","maintenance").

**Freshness:** max Effective/Original-Licensure date observed in CONSTRUCTIONLICENSE_1.csv = **2026-07-11** (i.e. yesterday). The extract is refreshed effectively daily. STRONG.

---

## Source 2 — FDACS Pest Control + Lawn & Ornamental (Ch. 482)

**Landing:** `https://www.fdacs.gov/Business-Services/Pest-Control/Licensing-and-Certification`
As of **April 1, 2025** all legacy portals (`aesecomm`, `aessearch`, `ceu`, `fumigation`.fdacs.gov) were consolidated into the new **AES portal: `https://aeslicensing.fdacs.gov`**.

**Machine-readable download? NO static extract file.** The AES portal exposes a **Reports** menu with these named rolls:
- Individual Licenses — Statute 487
- **Individual Licenses — Statute 388 and 482** ← this is the Ch.482 pest-control/lawn-&-ornamental operator roll
- Pesticide Dealers and Customer Contact Ctrs
- **Pest Control Business Licenses** ← business-location licensees
- Earned CEU Search / Customer Exams / CEU Class Search

`https://aeslicensing.fdacs.gov/Reports` returns HTTP 200 (title "Reports") but the reports themselves are **Power BI embedded iframes** (page JS literally says "Refresh all powerBI Iframes on Login"). That means:
- They are interactive dashboards, viewable/filterable in-browser (county filtering is available inside the Power BI visual), and typically allow ad-hoc **Export to CSV/Excel** from within a visual — but there is **NO stable, directly-fetchable extract URL** (no `.csv`/`.txt` endpoint like DBPR or Sunbiz).
- No columns/rows could be captured read-only without driving the Power BI UI (out of scope — would need interactive session).

**Relevant Ch. 482 categories** (from statute + FDACS page): General Household Pest & Rodent, Termite/WDO, **Lawn and Ornamental Pest Control**, Fumigation; plus **Limited Commercial Landscape Maintenance (LCLM)** certification for landscape-maintenance applicators. The **Lawn & Ornamental** and **LCLM** categories are the landscaping-adjacent roll.

**County filter capability:** Yes, within the Power BI report (interactive), not via a URL param.
**Freshness:** Not measurable read-only (Power BI dataset refresh cadence not exposed); FDACS licensing data is generally near-real-time but UNVERIFIED here.
**Contact fields:** The public Power BI reports show name/license/category/location; there is **no exported email/phone** field in the public view. → enrichment required.

**FLAG for human:** A true bulk, machine-readable Ch.482 extract is **records-request-only** — FDACS public-records portal `https://fdacs.mycusthelp.com` / `https://www.fdacs.gov/Contact-Us/Public-Records-Requests`. The Power BI dashboards are the only no-cost programmatic-ish access, and they are not a clean file download. Do NOT script the portal without a human decision on whether Power BI export is acceptable.

---

## Source 3 — Sunbiz (FL Division of Corporations) Bulk Data

**Landing:** `https://dos.fl.gov/sunbiz/other-services/data-downloads/`
**Access (documented public creds, both browser + SFTP):**
- Host: `https://sftp.floridados.gov`
- Username: `Public`
- Password: `PubAccess1845!`
(After login, navigate the public directory to Corporate Data / Fictitious Name Data / Daily / Quarterly.)

**Cadence:** **Daily** files (generated each work day, contain filings ADDED that day — ideal for new-registration monitoring) and **Quarterly** files (Jan/Apr/Jul/Oct, full active snapshot; corporate quarterly is ≥1 GB).

**Format:** **Fixed-length ASCII text** (`.txt`), NOT delimited — every column is a fixed char width at a fixed start position. Layout doc: `https://dos.sunbiz.org/data-definitions/cor.html` (Corporate File Definitions).

### Corporate file layout (key fields — position / length)
| # | Field | Start | Len | Notes |
|---|---|---|---|---|
| 1 | Corporation (document) Number | 1 | 12 | |
| 2 | **Corporation Name** | 13 | 192 | business name for keyword filtering |
| 3 | Status | 205 | 1 | A/I |
| 4 | Filing Type | 206 | 15 | DOMP, FLAL (LLC), FORP, NPREG, etc. |
| 5 | **Address 1** | 221 | 42 | principal address |
| 6 | Address 2 | 263 | 42 | |
| 7 | **City** | 305 | 28 | (use to narrow to Orlando/Orange) |
| 8 | State | 333 | 2 | |
| 9 | **Zip** | 335 | 10 | |
| 17 | **File Date** | 473 | 8 | **filing/registration date** (MMDDYYYY) |
| 18 | FEI Number | 481 | 14 | |
| 20 | Last Transaction Date | 496 | 8 | |
| 31 | Registered Agent Name | 545 | 42 | |
| 33 | Registered Agent Address | 588 | 42 | agent street/city/state/zip follow |
| 37+ | Officer 1..6 (Title/Type/Name/Address/City/State/Zip+4) | 669+ | 42 blocks | up to 6 officers |

**Business name + address + filing date carriers:** Corporation Name (pos 13), Address 1/City/Zip (pos 221/305/335), **File Date (pos 473)**. Sunbiz has NO county field — filter to Orange by **City** (Orlando, Apopka, Winter Park, Ocoee, Winter Garden, etc.) and/or Zip prefixes (327xx, 328xx, 3418x).

**Keyword-filter to trades:** grep the Corporation Name (pos 13–204) and Officer/Agent names, case-insensitive, for: `landscap`, `lawn`, `pest`, `clean`, `janitor`, `irrigation`, `roofing`, `hvac`/`air condition`, `plumb`, `electric`, `fire protection`/`sprinkler`, `lawn & ornamental`, `tree`/`arbor`. Because Sunbiz is unregulated free-text, this is the **only** channel that captures the non-state-licensed trades (landscaping, janitorial, cleaning, tree/arborist).

**Freshness:** Daily file = same-work-day new registrations. STRONG for "just registered" signal.

**Contact fields:** Name + principal address + registered-agent address + officer addresses. **NO email, NO phone.** → enrichment required.

---

## Contact-field verdict per source (Round 7 confirmation)

| Source | Email? | Phone? | Verdict |
|---|---|---|---|
| DBPR CONSTRUCTIONLICENSE_* (licensee roll) | No | No | Enrichment required |
| DBPR `constr_app.csv` (APPLICANTS) | No | **YES (phone)** | Partial — phone for new/pending contractors |
| DBPR `swimpool_exam.csv` (niche) | **YES** | **YES** | Not a target trade |
| FDACS Ch.482 (Power BI reports) | No | No | Enrichment required; bulk = records-request |
| Sunbiz corporate/fictitious bulk | No | No | Enrichment required |

**Round 7 conclusion CONFIRMED:** none of the primary trade rolls publish email, and only DBPR's *applicant* file publishes phone. Address-only otherwise → a downstream enrichment stage (name+address → phone/email append) is mandatory for the main buyer lists.

---

## STACK RANKED by contact-data quality

1. **DBPR `constr_app.csv` (Construction + Electrical Applicants)** — the ONLY primary roll with a phone number, plus county code and trade description. Best raw contactability, but limited to new/pending applicants (a subset), and licensed construction trades only. Direct CSV, daily-ish fresh.
2. **DBPR CONSTRUCTIONLICENSE_1/2/3.csv** — largest, cleanest, header-documented, county `58` filterable, freshest (max date 2026-07-11), full name+DBA+address. No contact info → needs enrichment, but the highest-volume, highest-structure source. Covers HVAC/AC, roofing, plumbing, electrical, fire protection well.
3. **Sunbiz bulk (daily/quarterly, SFTP public creds)** — only source covering the NON-licensed trades (landscaping, janitorial, cleaning, irrigation, tree) via name keyword. Fixed-width, business-name + address + filing date, daily new-registration cadence. No contact info; no county field (filter by city/zip). Enrichment required.
4. **FDACS Ch.482 (Power BI)** — necessary for the landscaping proxy (lawn & ornamental + LCLM) and pest control, but WORST machine-readability: no static file, Power BI iframe only, bulk extract is records-request. Address-level, no contact export.

## Trade coverage — well-covered vs thin

**Well-covered (clean, structured, county-filterable state extracts):**
- HVAC/AC — DBPR `CAC`/`CMC`/`RA`/`RM`
- Roofing — DBPR `CCC`/`RC`
- Plumbing — DBPR `CFC`/`RF`/`RP`
- Electrical — DBPR ECLB codes inside CONSTRUCTIONLICENSE
- Fire protection — DBPR `FRO`

**Thin / proxy-only:**
- **Irrigation** — no FL license by name; weak proxy = DBPR `CUC` (underground utility) or Sunbiz keyword "irrigation".
- **Landscaping** — NOT state-licensed; proxy = **FDACS Lawn & Ornamental / LCLM (Ch.482)** [Power BI, hard to extract] + Sunbiz keyword "landscap"/"lawn". No clean file.
- **Cleaning / Janitorial** — NOT licensed anywhere in FL; **Sunbiz keyword only** ("clean","janitor","maintenance"). Thinnest; entirely dependent on Sunbiz + enrichment.

**Bottom line:** Buildable today with clean files = DBPR (construction trades). Landscaping + janitorial are the weak spots — landscaping leans on the awkward FDACS Power BI plus Sunbiz keywording, and janitorial exists only as a Sunbiz keyword pull. All main rolls except DBPR-applicants require a phone/email enrichment stage.
