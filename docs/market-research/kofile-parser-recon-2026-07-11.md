# Kofile / GovOS PublicSearch — 7-Tenant Parser Recon

**Date:** 2026-07-11
**Scope:** Read-only research on PUBLIC endpoints only. Polite-client pacing (≥10s between tenants, single search per tenant, no bulk pulls). No logins/payments/registrations, no CAPTCHA bypass, no form submissions beyond one benign `SMITH` grantor query per tenant to render a results table. The "Export all Results" control was OBSERVED only, never clicked.
**Tenants:** dallas, tarrant, bexar, cameron, jefferson, nueces, hidalgo — all at `https://<county>.tx.publicsearch.us/`
**Status of findings:** UNVERIFIED recon. Exact URLs, sample values, and the producing query are included inline.

---

## 1. One-Parser Verdict

**One parser CAN serve all seven — with a per-tenant column-index map and a text-based doc-type classifier. It is NOT a single hardcoded selector set.**

What is IDENTICAL across all 7 (parse on these):
- **Same platform build.** All 7 are the same React SPA (Kofile/GovOS "PublicSearch", footer "Powered By Neumo"). Same JS bundle names, same routes (`/`, `/results`, `/search/advanced`), same homepage form, same `<table>` results DOM with `role=table/row/cell`.
- **Same URL/query contract.** The results deep-link params are identical names everywhere: `department=RP`, `searchType=quickSearch`, `searchValue=<term>`, `recordedDateRange=YYYYMMDD,YYYYMMDD`, `keywordSearch=<bool>`, `searchOcrText=<bool>`, and pagination `limit`/`offset`.
- **Same leading columns.** Every tenant renders cells with positional classes `col-0, col-1, col-2, …`. In ALL 7: `col-0`=row-select checkbox, `col-1`=Actions (menu, `isDropdown hasIcon`), `col-2`=doc status icons (`isDropdown hasIcon`), then **`col-3`=GRANTOR, `col-4`=GRANTEE, `col-5`=DOC TYPE, `col-6`=RECORDED DATE, `col-7`=DOC/INST NUMBER, `col-8`=BOOK/…/PAGE, `col-9`=LEGAL DESCRIPTION`.**
- **Same page size (50)** and same "Export all Results" control on every tenant.
- **Same conveyance discriminator location:** granular deed types (DEED, WARRANTY DEED, …) live as FREE TEXT in the `col-5` Doc Type cell, NOT as filter codes.

Where tenants DIVERGE (parser must branch):
- **Trailing column set differs** (extra parcel columns after `col-9` LEGAL). Column COUNT ranges 10→16. But because the extras are appended AFTER `col-9`, the six core fields keep fixed indices `col-3..col-9` everywhere. Anchor on `col-3..col-9`; treat `col-10+` as optional tenant-specific parcel fields.
- **`col-7` header label differs:** "DOC NUMBER" (6 tenants) vs **"INST NUMBER" (Tarrant)**. Same index; label-agnostic parsing needed.
- **`col-8` label differs:** "BOOK/VOLUME/PAGE" (most) vs **"BOOK/LIBER/PAGE" (Tarrant)**.
- **Doc-type FILTER vocabulary differs per county** (coarse categories; see §3). This is a filter-UX difference only — it does NOT change how you read the `col-5` text.
- **Header casing differs** (Dallas Title Case "Doc Type"; others UPPERCASE "DOC TYPE"). Do not key on header text; key on `col-N` index.
- **`recordedDateRange` default start differs** (1800/1900/1753 depending on county). Irrelevant if you supply your own range.

**Recommended parser contract:** locate `table` → `tbody tr` (rows) → read by fixed index: grantor=`td.col-3`, grantee=`td.col-4`, docType=`td.col-5`, recordedDate=`td.col-6`, docNumber=`td.col-7`, book=`td.col-8`, legal=`td.col-9`. Classify conveyance by regex on the `col-5` text. Ignore `col-0/1/2` (controls/icons) and `col-10+` (optional parcel extras — but grab PROPERTY ADDRESS / PARCEL NUMBER where present, they're gold for new-mover matching).

---

## 2. Results-Table Selector Map

Structure everywhere: `<table>` (ARIA `role=table`, caption "Search results table for Property Records") → header `row` of `columnheader` → `tbody`/rowgroup of `row`s → `cell`s. **Cells have NO `data-testid`/`data-column`/`id` — only positional classes `col-N`.** So the parser MUST use column index (or header-text→index mapping computed once per tenant). Search-term hits inside a cell are wrapped in an `<em>` (`emphasis`) tag — strip these when reading text.

Fixed core indices (identical across all 7):

| Field | Cell selector | Notes |
|---|---|---|
| Row select | `td.col-0` | checkbox — skip |
| Actions | `td.col-1` (`isDropdown hasIcon`) | menu — skip |
| Status icons | `td.col-2` (`isDropdown hasIcon`) | icons — skip |
| **GRANTOR** | `td.col-3` | |
| **GRANTEE** | `td.col-4` | |
| **DOC TYPE** | `td.col-5` | granular deed type as free text |
| **RECORDED DATE** | `td.col-6` | M/D/YYYY |
| **DOC / INST NUMBER** | `td.col-7` | header "DOC NUMBER" except Tarrant="INST NUMBER" |
| BOOK/…/PAGE | `td.col-8` | "BOOK/VOLUME/PAGE" or Tarrant "BOOK/LIBER/PAGE"; often `--/--/--` |
| **LEGAL DESCRIPTION** | `td.col-9` | subdivision/lot/block free text; may be `N/A` |

Per-tenant trailing columns (after `col-9`) and total column count:

| Tenant | Total cols | Trailing extras (index → label) |
|---|---|---|
| **dallas** | 11 | `col-9`=Town, `col-10`=**Legal Description** ⚠ |
| **tarrant** | 10 | none (Legal at `col-9`) |
| **bexar** | 15 | `col-10`=Lot, `col-11`=Block, `col-12`=NCB, `col-13`=County Block, `col-14`=Property Address |
| **cameron** | 10 | none (Legal at `col-9`) |
| **jefferson** | 16 | `col-10`=Lot, `col-11`=Block, `col-12`=NCB, `col-13`=County Block, `col-14`=Property Address, `col-15`=Parcel Number |
| **nueces** | 12 | `col-10`=Lot, `col-11`=Block |
| **hidalgo** | 10 | none (Legal at `col-9`) |

⚠ **DALLAS IS THE ONE STRUCTURAL EXCEPTION.** Dallas inserts a **"Town" column at `col-9`** and pushes **LEGAL DESCRIPTION to `col-10`**. It also has NO "Doc Number" header collision but DOES keep Doc Number at `col-7`. So for Dallas ONLY: `legal = td.col-10` (not `col-9`), and `col-9` = Town. Every other tenant: legal = `col-9`. **The safest cross-tenant approach is to map header text → column index once per tenant at load** (read the `columnheader` row, find "LEGAL DESCRIPTION"/"GRANTOR"/etc., record indices), then read cells by those indices. That handles Dallas's Town-shift and all trailing-column variance automatically. Header text is stable enough for this (case-insensitive contains-match on GRANTOR/GRANTEE/DOC TYPE/RECORDED DATE/DOC…NUMBER/INST…NUMBER/LEGAL DESCRIPTION).

---

## 3. Doc-Type Vocabulary per County (conveyance discriminator)

**Critical finding:** The **Document Types filter is COARSE** on every tenant — it lists broad CATEGORY buckets, not granular deed types. Conveyances (WARRANTY DEED, DEED, SPECIAL WARRANTY DEED, DEED W/VENDOR'S LIEN, etc.) are bucketed under a single umbrella category ("REAL PROPERTY" on 5 tenants; "OPR" = Official Public Records on Tarrant & Bexar). Expanding that umbrella node in the filter listbox did NOT reveal nested granular deed-type checkboxes (tested on Hidalgo — option count stayed at 4). **Therefore the granular "new mover" deed type is recovered ONLY from the free-text `col-5` DOC TYPE cell, not from a filter code.** Confirmed by sampling Hidalgo `col-5` values on the live SMITH results: `DEED`, `AFFIDAVIT`, `HOSPITAL LIEN`, `ABSTRACT JUDGEMT`, `ASSUMED NAME`, `FEDERAL TAX LIEN` — i.e., the granular string is in the cell even though the filter only offers the "REAL PROPERTY" bucket.

Filter categories captured per tenant (top-level Document Types listbox), with the **conveyance umbrella bolded**:

| Tenant | Conveyance umbrella | Full filter category list (as shown) |
|---|---|---|
| **dallas** | **REAL PROPERTY** | BOND; CHILD SUPPORT LIENS; FEDERAL TAX LIENS; FINANCING STATEMENTS; HOSPITAL LIENS; PLATS; **REAL PROPERTY**; STATE TAX LIENS |
| **tarrant** | **OPR** | **OPR** (single umbrella node; all record types nested under Official Public Records) |
| **bexar** | **OPR** | FEDERAL TAX LIENS; **OPR**; STATE TAX LIENS; UCC RP |
| **cameron** | **REAL PROPERTY** | CHILD SUPPORT LIENS; FEDERAL TAX LIENS; FINANCING STATEMENTS; **REAL PROPERTY**; STATE TAX LIENS |
| **jefferson** | **REAL PROPERTY** | BONDS AND DEPUTATIONS; CHILD SUPPORT LIENS; FEDERAL TAX LIENS; FINANCING STATEMENTS; HOSPITAL LIENS; PLATS; **REAL PROPERTY**; STATE TAX LIENS; STEVEDOR LICENSES |
| **nueces** | **REAL PROPERTY** | ASSUMED NAME; BONDS AND DEPUTATIONS; CHILD SUPPORT LIENS; FEDERAL TAX LIENS; FINANCING STATEMENTS; PLATS; **REAL PROPERTY**; STATE TAX LIENS |
| **hidalgo** | **REAL PROPERTY** | ABSTRACT OF JUDGMENT; ASSUMED NAME; LIEN; **REAL PROPERTY** |

**Parser guidance for conveyance detection:** Do NOT rely on the filter. Filter to the umbrella (REAL PROPERTY / OPR) to reduce noise if desired (in-app only — see §4), then classify each row by a regex over `col-5` text. Suggested conveyance regex (case-insensitive, tune against live data): `/\b(WARRANTY\s+DEED|SPECIAL\s+WARRANTY|DEED\s*W\/?\s*VEND|GENERAL\s+WARRANTY|GIFT\s+DEED|\bDEED\b)/` while EXCLUDING `DEED OF TRUST`, `RELEASE`, `SUBSTITUTE TRUSTEE`, `DEED RESTRICTION`. Observed live `col-5` samples include bare `DEED` (Hidalgo), plus non-conveyances `RESIGNATION OF TRUSTEE`, `MEMORANDUM MEMO`, `AFFIDAVIT`, `POWER OF ATTORNEY`, `RELEASE` (Dallas/Tarrant). Vocabularies are free-text and county-specific, so the classifier must be a maintained keyword list per county, seeded from a broad pull, NOT the filter categories.

---

## 4. Pagination + URL / docType encoding

- **Page size:** 50 rows/page on ALL 7 (default; observed `Results Per Page: 50`).
- **Pagination is URL-addressable** via `limit` + `offset`. Numbered pager with prev/next (`◀ 1 2 3 … ▶`, `aria-label="page N"`, `"next page"`, `"previous page"`). Clicking page 2 on Dallas produced `…&limit=50&offset=50&…`. So page N deep-link = `offset=(N-1)*50&limit=50`.
- **Deep-link shape (reproducible, confirmed live on every tenant by driving the homepage Search button):**
  `https://<county>.tx.publicsearch.us/results?department=RP&keywordSearch=false&recordedDateRange=YYYYMMDD,YYYYMMDD&searchOcrText=false&searchType=quickSearch&searchValue=<TERM>`
  add `&limit=50&offset=<N>` for paging. Example live URL (Bexar):
  `https://bexar.tx.publicsearch.us/results?department=RP&keywordSearch=false&recordedDateRange=18000101,20260707&searchOcrText=false&searchType=quickSearch&searchValue=SMITH`
- **`searchValue` is REQUIRED to render a table.** A date-range-only URL (no `searchValue`) does NOT return records — the SPA treats the raw date string as a text query and shows "No Results Found" (reproduced on Dallas with `?department=RP&recordedDateRange=20250601,20250605&searchType=quickSearch`). ⚠ This CORRECTS the prior-round note that a date-only `recordedDateRange` deep-link returns a rendered table — it did not in this harness. You must supply a `searchValue` (e.g., a grantor/grantee token, or a broad wildcard-ish common term) alongside the date range. `keywordSearch`/`searchOcrText` default `false` (index-only search; the "Search Index & Full Text (OCR)" radio flips `searchOcrText=true`).
- **docType is NOT URL-addressable — it is in-app-only.** Selecting a Document-Types category (tested "REAL PROPERTY" on Dallas) did NOT change the URL and there is NO Apply button; the filter narrows the already-fetched client-side result set (or fires an XHR with the docType in the POST body, not the querystring). The filter listbox options use ephemeral `downshift-*` generated ids (e.g., `downshift-3-item-6`), NOT stable codes — do not target these. **Conclusion: to filter by doc type you cannot build a URL; you must either (a) pull the umbrella/all results by date+searchValue and classify `col-5` text yourself (recommended), or (b) drive the in-app checkbox via automation.**
- Nav also exposes an **Advanced Search** route (`/search/advanced`) with more structured fields (department + date-range presets), not exercised here.

---

## 5. Export Control Observation (observed, NOT clicked)

- **Present on ALL 7 tenants:** a button labeled exactly **"Export all Results"** on the results view.
- Not clicked (per boundaries). No inline row-limit note was visible next to the control at rest; any cap/limit or paywall/registration gate would only surface on click (likely requires Sign In / a paid account — the header always shows Register / Sign In, and cart/certification pricing strings exist in the bundle). **FLAG:** export likely gated behind login/payment — do not attempt; classify as human-review if bulk export is ever needed.

---

## 6. Rate-Limit Posture (per tenant)

**No throttling encountered on any tenant.** Every tenant returned a fully rendered 50-row table with its result count. Requests were paced ≥10s apart, one search each. No 429, no "Too Many Requests", no "unusual traffic"/Access-Denied/Retry-After interstitial, no CAPTCHA/Turnstile challenge on any of the seven.

| Tenant | Certified through | SMITH result count | Throttle / block? |
|---|---|---|---|
| dallas | 07/08/2026 | 284,579 | none |
| tarrant | 07/07/2026 | 265,192 | none |
| bexar | 07/07/2026 | 140,918 | none |
| cameron | 07/08/2026 | 20,221 | none |
| jefferson | 07/09/2026 | 75,523 | none |
| nueces | 07/09/2026 | 24,446 | none |
| hidalgo | 07/08/2026 | 36,108 | none |

Note: an early automated regex flagged a false-positive "429" on Tarrant — it matched the substring "429" inside row DATA (a doc number), not an HTTP status; the page rendered 50 rows normally. No actual rate limit. This differs from the Ionwave platform-wide per-IP limit seen in prior rounds — PublicSearch did not throttle single, paced, index-only searches. Caution still warranted for any future high-volume paging (Export is the intended bulk path and is gated).

---

## Appendix — Recon Method / Reproducibility

- Tool: OpenClaw `browser` (read-only `snapshot` + minimal `type`/`click` to submit ONE `SMITH` grantor quick-search per tenant; `evaluate` used only to read the rendered DOM — result counts, header labels, `td.col-N` classes, filter `role=option` labels, pagination `aria-label`s).
- Per tenant: navigate homepage → wait render → type `SMITH` in "Search Term" → click "Search" → wait → read results DOM. Paced ≥10s between tenants.
- The real query contract was recovered from the live results URL the app itself built on Search submit (params: `department, keywordSearch, recordedDateRange, searchOcrText, searchType, searchValue`), corroborated by the client JS bundle's param list `["department","limit","offset","searchType","parties","sort",…]` and date keys `["recordedDateRange","instrumentDateRange","applicationDateRange","meetingDateRange"]`.
- SPA note: `/api/config` is same-origin and 404s on a direct `fetch` (falls back to the SPA shell); the document-search XHR host is not hardcoded in the bundle (runtime-resolved). DOM reads via `snapshot`/`evaluate` were reliable in this harness — no need to reverse the XHR. Prior-round "click/evaluate flakiness" reproduced once as stale results state on pure URL nav (no `searchValue`); driving the homepage form avoided it.
