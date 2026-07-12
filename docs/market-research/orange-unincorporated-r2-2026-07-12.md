# Unincorporated Orange County, FL — Code / Permit / OCPA-Imagery Re-Probe (Round 2)

**Date:** 2026-07-12
**Scope:** Read-only research on PUBLIC endpoints only. No logins, payments, registrations, form submissions, or CAPTCHA/Turnstile bypass. All findings UNVERIFIED — exact URLs, sample rows, and queries included. Freshness = MAX RECORD DATE observed (never a metadata "modified" field).

---

## VERDICT SUMMARY

| Target | Verdict | Freshness proof |
|---|---|---|
| County code enforcement (EPD Violation / Active Violations) | **NO-BUILD** (pending recovery) | `/query` verb down server-wide on `ocgis4.ocfl.net` — HTTP 000 timeout; freshness un-obtainable |
| County building permits (record-level, valuation-bearing, non-Accela) | **NO-BUILD** | Only candidate (Economic Incentive Permits) is frozen at **max Issue_Date 2021-02-22** |
| OCPA parcel imagery (photo + building sketch) | **YES** | Anonymous JPEGs returned HTTP 200; photo caption dated 3/7/2022, sketches present |

---

## 1. County Code Enforcement — NO-BUILD (query verb still broken)

The county code-enforcement data lives on `ocgis4.ocfl.net` ArcGIS (v10.91). The layers exist with a **rich, correct schema**, but the `/query` verb is **down across the entire server** — same failure as round 8, still not recovered.

**Layers carrying the code-enforcement data (metadata loads fine, HTTP 200 in ~0.15s):**
- `Public_Dynamic/MapServer/0` — "EPD Active Violation/Open Incidents"
- `Public_Dynamic/MapServer/1` — "EPD Violation All"
- `Public_Dynamic/MapServer/13` / `15` — "Active Violations and Open Incidents" / "Active Violations"
- Mirrored in `InfoMap_Public_Layers/MapServer/5` and `AGOL_Open_Data/MapServer/53`

**Schema (from `Public_Dynamic/MapServer/0?f=json`, HTTP 200, esriGeometryPoint, maxRecordCount 1000, capabilities Map,Query,Data):**
```
OBJECTID, INCI_ID (Incident Number), INCI_TYP / INCI_TYP_DESC (Incident Type),
INCI_DESC, INCI_ST_CD / INCI_STAT (Status), CITY_COMM_DIST (Commissioner District),
INCI_ZONED (Zoning Category  <-- commercial/residential discriminator),
INCI_SECTION_DESC, INCI_CLASS_DESC,
INSP_RES_DT (Inspection Date  <-- freshness field), INSP_RESULTS, INSP_TYP,
EMP_ORACLE_ID (Inspector), NAME_NAME (Owner), NAME_ST_ADDR_1/2, NAME_CITY/ST/ZIP,
EPD_OFFICIAL_PARCEL_ID (Parcel ID), EPD_COMPLETE_ADDRESS (Full Street Address),
EPD_LINK (Incident Summary URL)
```
This schema is at the same bar as the City `k6e8-nw6w` feed: it has an inspection date (`INSP_RES_DT`) for freshness and a zoning category (`INCI_ZONED`) as the commercial-vs-residential discriminator. **But it cannot be read.**

**The break (exact evidence, probed 2026-07-12T18:21Z):**
```
metadata: GET .../Public_Dynamic/MapServer/1?f=json                 -> HTTP 200, 0.156s
query:    GET .../Public_Dynamic/MapServer/1/query?where=1=1
                 &returnCountOnly=true&f=json                        -> HTTP 000, 30.0s timeout
```
Verified NOT layer-specific — `/query` returns HTTP 000 (connection never completes) on every layer/service tested on this host:
- `Public_Dynamic/MapServer/0,1,13,15/query` → HTTP 000 / empty body / 45s timeout
- `AGOL_Open_Data/MapServer/53/query` → HTTP 000, 45s
- `InfoMap_Public_Layers/MapServer/5/query` → HTTP 000, 45s
- `Public_Base/MapServer/32/query` (Parcels) → HTTP 000, 40s
- `iWorQ/MapServer/0/query` → HTTP 000, 40s

**Conclusion:** The `/query` verb on `ocgis4.ocfl.net/arcgis` is down server-wide (metadata endpoints serve fine, only `/query` stalls). Freshness cannot be established (no orderBy/outStatistics call succeeds). **County-wide code enforcement stays NO-BUILD pending server recovery.** No AGOL-hosted queryable mirror of this data exists (searched org `0U8EQ1FrumPeIqDb`; "IncidentsUpdated" is an unrelated 22-record discharge-incident feed, not code enforcement).

---

## 2. County Building Permits — NO-BUILD (no fresh, non-Accela, record-level feed)

Searched the county AGOL org (`ocfl.maps.arcgis.com`, orgid `0U8EQ1FrumPeIqDb`) and its hosted Feature Server (`services1.arcgis.com/0U8EQ1FrumPeIqDb`) for any permit feed outside the gated Accela portal.

**Only candidate found:** `Economic_Incentive_Permits_Updated/FeatureServer/0` — public, queryable, 84,341 records.

**Schema is genuinely valuation-bearing:**
```
Parcel, PID, Fee_Amount, Work_Type, Sub_Type, Folder_Type, Issue_Date, Stamp_Date, ...
```
**Sample rows (orderByFields=Issue_Date DESC, resultRecordCount=3):**
```
Parcel 17-24-31-1212-00-060 | Fee_Amount 228  | Work_Type New Construction | Sub_Type Residential | Folder_Type Mechanical Permit | Issue_Date 2021-02-22
Parcel 36-23-28-7168-01-000 | Fee_Amount 424  | Work_Type Alteration       | Sub_Type 22 Recreational/Social/Sauna | Folder_Type Commercial Permit | Issue_Date 2021-02-22
```
Folder_Type distinguishes "Commercial Permit" vs "Residential Permit"; Fee_Amount gives valuation proxy.

**FRESHNESS — FROZEN (outStatistics max query):**
```
GET .../Economic_Incentive_Permits_Updated/FeatureServer/0/query
      ?outStatistics=[{max Issue_Date},{max Stamp_Date}]
-> maxIssue = 1614022773000 = 2021-02-22
   maxStamp = 1610724637000 = 2021-01-15
```
Max record date is **2021-02-22** — over 5 years stale. This is the round-6 Hillsborough trap (rich schema, dead data). It is also an incentive-program-scoped dataset, not general countywide permitting.

**Other items checked, all rejected:**
- `GMB133 - Structure Permitting` (CSV, item 668faa86...) — static file last modified **2019-04-05**, 44 MB dump, not a live feed.
- `Admin_Building`, `Permit Map Search - Map` (web map a5663f0c...) — the "permit map" is only zoning/property/utility overlay layers for visual context; it contains NO permit-record layer.
- `Orange County Historic Permitting 1971-2017` — a PDF.

**Conclusion:** No live, record-level, valuation-bearing county building-permit feed exists outside the gated Accela portal. The only structured feed is frozen at 2021. **County permits NO-BUILD — city-only permit coverage stands.** (Accela portal itself was NOT probed for login/gated access, per boundaries.)

---

## 3. OCPA Parcel Imagery — YES (photo + building sketch, anonymous)

Host `https://ocpaimages.ocpafl.org` exposes a **publicly readable Swagger** at `/swagger/v1/swagger.json` (title "OCPA Image API", v1). The two image routes:

| Route | Params | Result |
|---|---|---|
| `GET /api/Image/GetPIDImage` | `pid` | Property photo JPEG |
| `GET /api/Image/GetPIDSketch` | `pid`, `bldgNum` | Building sketch JPEG |

**Callable routes (valid Orange PIDs taken from the permits feed above):**
```
GET https://ocpaimages.ocpafl.org/api/Image/GetPIDImage?pid=312417121200060
   -> HTTP 200, image/jpeg, 278,231 bytes, 1296x1028
      (visually confirmed: real photo, caption "10600 LAGO BELLA DR, UN-INCORPORATED, FL 32832  3/7/2022")

GET https://ocpaimages.ocpafl.org/api/Image/GetPIDSketch?pid=312417121200060&bldgNum=1
   -> HTTP 200, image/jpeg, 69,109 bytes, 1024x768 (building sketch)
```
Reproduced on a second parcel `pid=282336716801000` (photo 312 KB + sketch 64 KB, both HTTP 200).

**Gating check — NONE:**
- Response headers on an anonymous request: `HTTP/1.1 200 OK`, `Content-Type: image/jpeg`, `Cache-Control: no-store,no-cache`, `X-Powered-By: ASP.NET`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`.
- **No `WWW-Authenticate`, no `Set-Cookie`, no Referer requirement, no API key, no rate-limit headers.** Requests were sent with no Referer/Origin/auth and still returned full images.
- `bldgNum=0` → 404 (buildings are 1-indexed); `bldgNum=1` works. Multi-building parcels are reachable by incrementing `bldgNum`.

Notes: routes are exactly `GetPIDImage` (photo) and `GetPIDSketch` (sketch); guesses like `GetSketch`, `GetBuildingSketch`, `GetPhoto`, `GetPIDMap` all 404 — use only the two swagger-documented names. The Swagger also lists POST upload routes (`UploadPhotos`, `UploadDocument`) — do NOT touch (write endpoints, out of scope).

**Conclusion:** **YES** — OCPA property photos and building sketches are anonymously callable and can enrich a sold sheet with the official parcel photo + sketch. PID is the OCPA parcel id (15-digit, e.g. `312417121200060`), obtainable from the FDOR parcel layer or the permits feed. No key/referer gating to flag.
