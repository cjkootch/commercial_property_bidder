# GovOS / Kofile PublicSearch API Recon (7-County TX Deed Fetcher)

**Date:** 2026-07-11 (probe run 2026-07-12)
**Scope:** Read-only research on PUBLIC endpoints only. No logins, payments, registrations, or CAPTCHA/Turnstile bypass. Polite pacing (≥10s between probes), shape-only, no bulk pulls.
**Method:** OpenClaw `browser` tool driving the real SPA (Bexar), instrumenting the live in-page transport (WebSocket) + reading the client JS bundle; cross-checked Dallas + Cameron.
**Status:** UNVERIFIED research findings. All request/response bodies below were captured live from the sites' own socket during normal use. Field names are as observed. No API endpoint is fabricated.

---

## VERDICT

**CAN THE FETCHER USE THE JSON API DIRECTLY AND SKIP DOM SCRAPING? → YES (with one hard prerequisite).**

- The search results are **NOT** delivered by REST/XHR and are **NOT** server-rendered into the results HTML. They travel over a **WebSocket**: `wss://<tenant>.tx.publicsearch.us/ws`, as JSON messages. (This is why the earlier round-5 probe saw "no reachable API host" and why plain HTML scraping of `/results` returns an empty shell — the rows never appear in the fetched HTML.)
- **THE KEY QUESTION — empty searchValue:** **YES. The API returns full rows for a date-range-only query with `searchValue:""`.** The UI refuses it, but the backend does not. Verified live on Bexar: `searchValue:""` + `recordedDateRange:"20240103,20240103"` + `department:"RP"` returned rows with `meta.numRecords: 830` for that single day. Same behavior confirmed on Dallas (1129 records/day) and Cameron.
- **This unlocks the "skip DOM" path**: iterate calendar days, query each day with empty searchValue, page through with `limit`/`offset`. No search term needed. No DOM parsing needed.

**The one prerequisite / caveat (the real blocker the earlier probe hit):** the WebSocket requires an `authToken` = `window.__ort`, a per-tenant, per-page-load UUID that is **injected into the SSR HTML at page load** and is **same-origin only**. You cannot call the API "cold" from arbitrary infra — you must first GET the tenant's HTML page, scrape `window.__ort` out of it, then open `wss://<tenant>/ws` (same origin) and send messages carrying that token. It is not a login and not a paywall (no account, no cookie, no CAPTCHA), but it IS a runtime handshake. See "Auth/Rate posture" below.

**Partial only if** the fetcher's infra cannot open outbound WebSockets to the tenant origin or cannot execute enough JS to obtain `__ort`. If WS is not viable from our infra, fall back to the round-5 DOM-scrape plan. See fallback note at end.

---

## 1. SEARCH REQUEST SPEC

**Transport:** WebSocket, same-origin. `wss://bexar.tx.publicsearch.us/ws` (hardcoded in bundle as `` `wss://${window.location.host}/ws` ``).
**Message framing:** JSON text frames. Envelope shape (all messages): `{ type, payload, authToken, correlationId, sync }`. Backend is Kofile `ko-search-api` (confirmed by a bundle comment referencing `github.com/kofile/ko-search-api`).

**The search message (captured live, exact):**

```json
{
  "type": "@kofile/FETCH_DOCUMENTS/v4",
  "payload": {
    "query": {
      "limit": "50",
      "offset": "0",
      "department": "RP",
      "keywordSearch": false,
      "recordedDateRange": "20240103,20240103",
      "searchOcrText": false,
      "searchType": "quickSearch",
      "searchValue": "garcia"
    },
    "workspaceID": "0p2ahd2wumuz8b6ke3vmo"
  },
  "authToken": "8cf57192-6708-42b2-874c-a8cedd61a1db",
  "correlationId": "cc9142b0-b71d-45c6-b041-0ed20ace4283",
  "sync": true
}
```

**How the parameters encode** (all inside `payload.query`, string or bool):
- **Date range:** `recordedDateRange: "YYYYMMDD,YYYYMMDD"` (comma-joined, inclusive). Same param name as the UI URL. Also supports `instrumentDateRange` and `applicationDateRange` (seen in bundle).
- **Doc type:** filtered via the same query object; the UI applies doc-type facets client-side after fetch, but the backend also returns a `docTypes` facet histogram in `meta.statistics` (see schema). (Server-side doc-type narrowing is available through the advanced-search fields; quick search returns all types + the facet counts.)
- **Page size:** `limit` (string). **Offset:** `offset` (string). Both honored server-side.
- **Search term:** `searchValue` (string). **Empty string returns rows** (key finding).
- `department: "RP"` = Real Property / land records (same across all three tenants tested).
- `keywordSearch` / `searchOcrText`: booleans, `false` for indexed quick search.
- `workspaceID`: a client-generated tab id, echoed back in the response; can be any string (the server does not validate it against a session — an arbitrary value like `"search"` worked in probes).

**KEY-QUESTION TEST (explicit, empty searchValue):**
Sent over Bexar's live socket:
```json
{"type":"@kofile/FETCH_DOCUMENTS/v4","payload":{"query":{"limit":"100","offset":"0","department":"RP","keywordSearch":false,"recordedDateRange":"20240103,20240103","searchOcrText":false,"searchType":"quickSearch","searchValue":""},"workspaceID":"search"},"authToken":"<__ort>","correlationId":"<uuid>","sync":true}
```
**Result:** `@kofile/FETCH_DOCUMENTS_FULFILLED/v6` with **100 rows returned** and **`meta.numRecords: 830`** (total for that day). Rows are real, current deed records — NOT the placeholder set. → **The API accepts and returns a date-range-only query with no search term.**

---

## 2. RESPONSE SCHEMA

**Response message type:** `@kofile/FETCH_DOCUMENTS_FULFILLED/v6`
**Shape:** `payload.data.byOrder` = ordered array of `docId`s; `payload.data.byHash` = map of `docId -> record`; `payload.meta = { numRecords, statistics }`.
- `meta.numRecords` = total hit count for the query (use for pagination planning).
- `meta.statistics` = facet histograms: `recorded-years[]` and `docTypes[]` (each `{label, hits}`) — e.g. `DEED: 185`, `AFFIDAV: 39`, etc. Free doc-type counts without extra calls.

**ONE SANITIZED SAMPLE RECORD** (`payload.data.byHash["<docId>"]`, from Bexar 1/3/2024, values lightly anonymized — real structure preserved):

```json
{
  "docId": 1871XXXXX,
  "instrumentNumber": "20240001360",
  "docNumber": "20240001360",
  "docNumberRange": 20240001360,
  "year": 2024,
  "recordedDate": "1/3/2024",
  "instrumentDate": "12/29/2023",
  "docType": "DEED OF TRUST",
  "docGroup": "OPR",
  "grantor": ["LASTNAME FIRSTNAME", "OTHER PARTY", ""],
  "grantee": ["LASTNAME FIRSTNAME", ""],
  "parties": [
    {"partyTypeCode": "D", "name": "LASTNAME FIRSTNAME", "type": "grantor", "isDirect": true,
     "nameCompletion": {"output": "LASTNAME FIRSTNAME", "input": ["LASTNAME FIRSTNAME","LASTNAME","FIRSTNAME"]}}
  ],
  "legalDescription": ["Subdivision-  Name: PALO ALTO #2 Lot: 9 Block: 23 NCB: 14552,, Reference - 20001 / 1856", ""],
  "legals": [
    {"legalType": "Subdivision", "developmentName": "PALO ALTO #2", "developmentTypeId": 1,
     "lot": "9", "block": "23", "block2": "14552", "lglBook": "20001", "lglPage": "1856",
     "description": "Subdivision-  Name: PALO ALTO #2 Lot: 9 Block: 23 NCB: 14552,, Reference - 20001 / 1856"}
  ],
  "lot": ["9"], "block": ["23"], "block2": ["14552"], "block3": [],
  "bookVolumePage": "--/--/--", "volumeInt": 0,
  "propertyAddress": ["10406 EXAMPLE DRIVE, SAN ANTONIO, TEXAS, 78224"],
  "propAddr": [{"address1": "10406 EXAMPLE DRIVE", "city": "SAN ANTONIO", "state": "TEXAS", "zip": "78224"}],
  "pageCount": 9,
  "images": [{"id": 1770XXXXX, "type": "stamped", "previewType": "png", "color": false, "totalPages": 9}],
  "attachments": [], "marginalReferencesCount": 1,
  "isSecured": false, "docVersion": 7, "metadataVersion": 2, "rsId": "17742421"
}
```

**Field map for the fetcher:**
| Need | Field |
|---|---|
| Grantor | `grantor[]` (also structured in `parties[]` where `type=="grantor"`) |
| Grantee | `grantee[]` (also `parties[]` `type=="grantee"`) |
| Doc type | `docType` (human label, e.g. "DEED OF TRUST"); `docGroup` = category (OPR/UCC RP) |
| Recorded date | `recordedDate` ("M/D/YYYY"); also `instrumentDate` |
| Doc/instrument number | `instrumentNumber` == `docNumber` (e.g. "20240001360"); internal `docId` (int) |
| Legal description | `legalDescription[]` (free text) + `legals[]` (structured: subdivision name, lot, block, book/page) |
| Property address | `propertyAddress[]` (formatted) + `propAddr[]` (structured) |
| Pages / image | `pageCount`, `images[]` |

---

## 3. CROSS-TENANT CONFIRMATION

Tested **Bexar**, **Dallas** (the "Town-column outlier"), and **Cameron**. All three: **same API, same shape, per-tenant host + token.**

| Tenant | Host / WS | department | Empty-searchValue result | `numRecords` (probe range) | Token (`__ort`) |
|---|---|---|---|---|---|
| Bexar | `wss://bexar.tx.publicsearch.us/ws` | `RP` | rows returned | 830 (1 day, 1/3/24) | `8cf57192-…` |
| Dallas | `wss://dallas.tx.publicsearch.us/ws` | `RP` | rows returned | 1129 (1 day, 1/3/24) | `e561b620-…` |
| Cameron | `wss://cameron.tx.publicsearch.us/ws` | `RP` | rows returned | 408 (3 days) | `a15e8a9a-…` |

- **Same message types** (`@kofile/FETCH_DOCUMENTS/v4` → `@kofile/FETCH_DOCUMENTS_FULFILLED/v6`), **same query params**, **same record schema** on all three.
- **Dallas "Town" column is a UI-only difference** — the API payload is identical; Dallas just renders an extra city/town column from the same `propAddr`/`legals` data. Not a per-tenant API difference.
- **Per-tenant, not shared:** host is the tenant subdomain; WS is same-origin. `department:"RP"` is consistent across all three for real-property/land records.
- **Token/cookie:** the only auth is `authToken = window.__ort`, a UUID unique per tenant AND per page load, embedded in the tenant's SSR HTML (`window.__ort = "..."`). No session cookie is required (only Google Analytics `_ga*` cookies were present). The same `__ort` also doubles as the WS `authToken` for the periodic `PING`. It appears tied to the page-load session; treat it as short-lived — re-scrape it per fetch run (and likely per tenant).

**Other tenants (Hidalgo, El Paso, Harris, Tarrant, Travis):** not re-probed this run, but all are the same `*.tx.publicsearch.us` GovOS/Kofile stack; expect identical behavior. Confirm each with one shape-probe before bulk use (host + `department` code + `__ort`).

---

## 4. PAGINATION LIMITS

- `limit:"50"` is the UI default. **Larger page sizes are honored:** `limit:"100"` returned exactly 100 rows.
- **Page-size ceiling ≈ 250.** Requesting `limit:"500"` returned only **250 rows** (server cap), not 500. Plan on **250 max per request.**
- **Deep offsets work with no degradation:** `offset:"500"` returned the correct tail slice (records 500→end of an 830-record set), `FULFILLED`, no error, sub-second.
- **Recommended paging:** for a day with N = `meta.numRecords`, page with `limit:"250"` and `offset` = 0, 250, 500, … until `offset ≥ N`. (830-record day = 4 requests.) Read `numRecords` from the first response to size the loop.

---

## 5. AUTH / RATE POSTURE

- **No API key, no bearer header, no account, no session cookie, no CAPTCHA/Turnstile** observed. Only Google Analytics cookies were set.
- **Required credential:** `authToken` = `window.__ort` (per-tenant, per-page-load UUID) embedded in the SSR HTML and echoed on every WS message. Obtain it by GETting the tenant page (`https://<tenant>.tx.publicsearch.us/`) and reading `window.__ort` (regex `window\.__ort\s*=\s*"([0-9a-f-]{36})"` in the returned HTML, or execute the page). It is same-origin scoped — the WS must be opened against the same tenant host.
- **HTTP status:** live searches returned `200`; all probe responses were `FULFILLED` (no `REJECTED`). **No 401 / 403 / 429 encountered on any tenant.** Nothing was gated; nothing required work-around; no tenant needed to be stopped.
- The WS heartbeats with a `PING` (`{type:"PING", authToken:__ort}`) every ~30s; a real client keeps the socket warm. For a fetcher, open WS → send FETCH_DOCUMENTS → read FULFILLED → close is sufficient per run.
- **Politeness for production:** this recon used ≥10s spacing and single probes. For the real fetcher, throttle hard (the task's ≥10s and no-bulk posture); one day at a time, sequential, is well within polite use. Watch for 429 on the WS and back off if seen.

---

## IMPLEMENTATION SKETCH (skip-DOM path)

Per tenant, per day:
1. `GET https://<tenant>.tx.publicsearch.us/` → extract `window.__ort`.
2. Open `wss://<tenant>.tx.publicsearch.us/ws` (Origin header = the tenant origin).
3. Loop offset 0,250,…: send
   `{"type":"@kofile/FETCH_DOCUMENTS/v4","payload":{"query":{"limit":"250","offset":"<n>","department":"RP","keywordSearch":false,"recordedDateRange":"<YYYYMMDD>,<YYYYMMDD>","searchOcrText":false,"searchType":"quickSearch","searchValue":""},"workspaceID":"fetcher"},"authToken":"<__ort>","correlationId":"<uuid>","sync":true}`
4. Read `FULFILLED` frames; collect `payload.data.byHash`; stop when `offset ≥ meta.numRecords`.
5. Close socket. Space runs politely.

---

## FALLBACK (if WS not viable from our infra)

If the fetcher's environment cannot (a) obtain `__ort` from the SSR HTML, or (b) open a same-origin outbound WebSocket to the tenant, then the JSON path is not usable and we revert to the **round-5 DOM-scrape plan**: drive the SPA with a headless browser, run a dated search WITH a broad `searchValue` (the UI requires it), and scrape the rendered results table. That path pays the DOM-parsing + required-search-term cost the JSON path avoids. Recommend attempting the WS path first (it is dramatically cheaper and gives structured fields + facet counts directly); keep DOM-scrape as the documented fallback.
