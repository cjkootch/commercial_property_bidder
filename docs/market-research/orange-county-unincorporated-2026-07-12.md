# Orange County (FL) Unincorporated — Permit + Code-Enforcement Feed Research

**Date:** 2026-07-12
**Scope:** Read-only research on PUBLIC endpoints only. No logins, payments, registrations, CAPTCHA/Turnstile bypass, form submissions, or outreach. Polite request rates; shape/freshness measurement only, no bulk scraping.
**Status:** UNVERIFIED. Findings are from live public metadata + query probes with exact URLs below. Where a max-record-date could not be extracted, that is stated plainly (never substituting a metadata "modified" timestamp).
**Task:** Round 7 permit/code BUILD (`ryhf-m453`, `k6e8-nw6w`) is City-of-Orlando limits only. This re-probes for a COUNTY-level (unincorporated Orange County) record-level, valuation-bearing building-permit feed and a county code-enforcement case feed.

---

## TL;DR verdicts

| Leg | Verdict | Reason |
|---|---|---|
| **County building permits (record-level, valuation-bearing)** | **NO-BUILD** | No queryable permit-record feed exists. The county "Permit Map Search" app carries only zoning/flood/parcel context layers and links out to a static Building-Safety webpage. Permit search is handled by an external permitting portal (Accela/Fast-style), not a public GIS/Socrata/CKAN feed. |
| **County code enforcement (case feed)** | **NO-BUILD (now) / RE-PROBE later** | A record-level code-enforcement schema DOES exist on the county ArcGIS server (`ocgis4.ocfl.net`, layers "EPD Violation All", "Active Violations and Open Incidents", etc.) with incident type, status, inspection date, address, parcel, coords. BUT the public `/query` endpoint is currently non-functional: `where=1=1` hangs (60–90s timeouts) and a single-record `objectIds=1` query returns **HTTP 500 "Error performing query operation."** Could not extract a single row or a max record date. Freshness UNVERIFIED. |
| **Launch scope** | **CITY-OF-ORLANDO-ONLY launch; unincorporated county = later expansion** | Neither county leg is currently buildable into a valuation/recency-filterable feed. |

---

## Environment / endpoint re-probe (Round 7 follow-up)

Round 7 noted `ocgis1.ocfl.net` did not respond. Confirmed and resolved:

- `ocgis1.ocfl.net` — **DNS NORESOLVE** (retired). Also NORESOLVE: `data.orangecountyfl.net`, `gis.ocfl.net`, `maps.ocfl.net`, `ocgis.ocfl.net`, `data.ocfl.net`.
- **`ocgis4.ocfl.net` — LIVE.** This is the county's current ArcGIS Server (`192.234.90.87`). It is the successor to the dead `ocgis1`.
  - Root: `https://ocgis4.ocfl.net/arcgis/rest/services?f=json`
  - Services: `AGOL_Open_Data`, `AGOL_Open_Data2`, `Public_Dynamic`, `Public_Notification`, `InfoMap_Public_Layers`, `Aurigo`, `Gridics`, `iWorQ`, geocoders.
- **Official county ArcGIS Online org:** "Orange County Government GIS", `urlKey=ocfl`, portal `https://ocfl.maps.arcgis.com`, orgId `0U8EQ1FrumPeIqDb`, hosted services at `https://services1.arcgis.com/0U8EQ1FrumPeIqDb/`.
- `orange.maps.arcgis.com` — this is a DIFFERENT tenant; its anonymous search leaks into the global ArcGIS Online index (returned Louisville/Vegas/Miami results). Not the FL county org. Ignored.
- **Property Appraiser** `ocpafl.org` REST (`maps.ocpafl.org`, `gis.ocpafl.org`) — HTTP "Service Unavailable" (no reachable ArcGIS REST for anonymous public querying).
- No Socrata (`data.orangecountyfl.net`) and no CKAN portal found. No live ArcGIS Hub open-data site (`data-ocfl.opendata.arcgis.com` returns a generic ArcGIS Hub shell but its DCAT feed = `"Domain record ... does not exist :: 404"` — no published catalog).

---

## LEG 1 — County building permits → **NO-BUILD**

### What was probed
- Org content search (orgId `0U8EQ1FrumPeIqDb`) for `permit / building / accela / aurigo / iworq`.
- The county's own **"OCFL Permit Map" / "Permit Map Search"** web app (item `cb9d41737de84f01b46b617bd57ac6a8`) and its web map (`a5663f0c46194cf3816a118fb5523044`).

### Findings
- The **Permit Map web map contains NO permit-record layer.** Its 21 operational layers are all context: Zoning, Future Land Use, FEMA Flood Zones, Parcels/Property Information, Jurisdictions, utility service providers, pickup zones, soil-for-permitting, easements. There is no permit table with valuation, work type, issue date, or applicant.
- The permit app's only outbound reference is a **static county webpage**: `https://www.orangecountyfl.net/PermitsLicenses/DivisionOfBuildingSafety.aspx`. This indicates the actual permit lookup is an external permitting-portal (Accela/Fast-style) with per-parcel search — **not** a bulk/record-level public feed.
- The ONLY permit-named hosted feature service in the org is **"Economic Incentive Permits"** (`.../Economic_Incentive_Permits_Updated/FeatureServer/0`) — an economic-development incentive layer (fields: `Parcel, Fee, Folder_Type, Work_Type, Issue_Date, FEEAMOUNT`). This is a niche subset, NOT general commercial/residential building permits, and not valuation-representative.
- "Admin Building" hosted layer = a single-field building footprint, not permits.

### Houston-style filter (`commercial + minCost + recency`)?
**Not expressible.** There is no general permit-record feed, hence no valuation/cost field, no commercial-vs-residential discriminator, and no queryable issue date for county building permits. (The Economic Incentive Permits layer has a Fee field but is not a general permit universe.)

**Verdict: NO-BUILD.** County building permits are behind an external portal; no public record-level valuation-bearing feed.

---

## LEG 2 — County code enforcement → **NO-BUILD (now), RE-PROBE later**

### What was probed
Layers discovered on `ocgis4.ocfl.net`:
- `Public_Dynamic/MapServer/0` — **EPD Active Violation/Open Incidents**
- `Public_Dynamic/MapServer/1` — **EPD Violation All** (appears to be full case history)
- `Public_Dynamic/MapServer/13`, `/15` — Active Violations and Open Incidents / Active Violations
- `AGOL_Open_Data/MapServer/53`, `/74` — Active Violations and Open Incidents
- `InfoMap_Public_Layers/MapServer/1` — "Code Enforcement" (group layer)

### Schema IS record-level and rich (from layer `?f=json`)
`EPD Violation All` (Public_Dynamic/1) fields:
`INCI_ID, INCI_TYP, INCI_TYP_DESC, INCI_DESC, INCI_STAT, CITY_COMM_DIST, INCI_ZONED, INCI_SECTION_DESC, INCI_CLASS_DESC, INSP_RES_DT, INSP_RESULTS, INSP_TYP, NAME_NAME, NAME_ST_ADDR_1, NAME_CITY, NAME_ST, NAME_ZIP, EPD_OFFICIAL_PARCEL_ID, EPD_COMPLETE_ADDRESS, EPD_LINK` (point geometry).

`Active Violations and Open Incidents` (AGOL_Open_Data/53) adds section/township/range, subdivision/block/lot, `CE_COMPLETE_ADDRESS`, `CE_OFFICIAL_PARCEL_ID`, `X_COORD/Y_COORD`, `CE_LINK`.

This schema WOULD support the case-type vocabulary the task wants (`INCI_TYP` / `INCI_TYP_DESC` / `INCI_DESC` — overgrowth/high grass, debris/illegal dumping, unsafe structure, green pool/stagnant water), plus status (`INCI_STAT`), inspection date (`INSP_RES_DT`), and full address/parcel/coords.

### But the data is NOT currently retrievable (blocker)
The `/query` endpoint is broken for these layers at probe time (2026-07-12):

- `.../Public_Dynamic/MapServer/1/query?where=1=1&returnCountOnly=true` → **timeout at 90s** (0 bytes).
- `.../AGOL_Open_Data/MapServer/74/query?where=1=1...` → **timeout at 60s**.
- `.../AGOL_Open_Data/MapServer/74/query?objectIds=1&outFields=...` → **HTTP 500 `{"error":{"code":500,"message":"Error performing query operation"}}`**.
- Map `export` (which draws these live layers) → timeout at 40s.

Control test proving it's the CE data, not the whole server: a query on the STATIC `Zip Codes` layer (`AGOL_Open_Data/MapServer/50/query?where=1=1&returnCountOnly=true`) returned **`{"count":68}` instantly**, and all CE-layer metadata (`?f=json`) returns in ~0.3s. So the server and query engine work; the **live database view behind the code-enforcement layers is failing** (500 / hang) for anonymous public queries.

### Consequence
- **3 sample rows: NOT OBTAINABLE** at this time (500 error / timeout — no row extracted).
- **Max record date (freshness): UNVERIFIED** — could not run the `outStatistics max(INSP_RES_DT)` query (same timeout/500). Do NOT assume fresh; do NOT trust any metadata "modified" (per the Hillsborough PermitsPlus lesson).

**Verdict: NO-BUILD now.** A record-level county code-enforcement schema exists and is the right shape, but its public query endpoint currently returns errors, so it is not consumable and its freshness is unproven. Re-probe on a later day: if `/query` recovers, this becomes a **BUILD** candidate (verify max `INSP_RES_DT` first).

### Exact queries to re-run on recovery
```
# count
https://ocgis4.ocfl.net/arcgis/rest/services/Public_Dynamic/MapServer/1/query?where=1%3D1&returnCountOnly=true&f=json
# freshness (max record date)
https://ocgis4.ocfl.net/arcgis/rest/services/Public_Dynamic/MapServer/1/query?where=1%3D1&outStatistics=[{"statisticType":"max","onStatisticField":"INSP_RES_DT","outStatisticFieldName":"mx"}]&f=json
# sample rows
https://ocgis4.ocfl.net/arcgis/rest/services/Public_Dynamic/MapServer/1/query?where=1%3D1&outFields=INCI_ID,INCI_TYP,INCI_TYP_DESC,INCI_DESC,INCI_STAT,INSP_RES_DT,EPD_COMPLETE_ADDRESS&orderByFields=INSP_RES_DT DESC&resultRecordCount=3&returnGeometry=false&f=json
```
(Also try the AGOL mirrors `AGOL_Open_Data/MapServer/53` and `/74` — same schema, possibly different backend view.)

---

## LEG 3 — Launch-scope recommendation

**Launch City-of-Orlando-only** using the existing Round-7 permit/code BUILD (`ryhf-m453`, `k6e8-nw6w`), which covers City of Orlando limits.

**Defer unincorporated Orange County to a later expansion**, because:
1. **County building permits:** no public record-level valuation feed exists (external portal only) → not buildable.
2. **County code enforcement:** the right record-level schema exists on `ocgis4.ocfl.net`, but its public query endpoint is currently returning 500/timeout, so it is not consumable and freshness is unproven → not buildable today, but a genuine re-probe target.

**Follow-up action:** schedule a re-probe of the `ocgis4.ocfl.net` code-enforcement `/query` endpoint (queries above). If it recovers and max `INSP_RES_DT` is recent, promote county code enforcement to BUILD and expand coverage to unincorporated Orange County. County building permits should be FLAGGED for a human (the permit portal is likely gated/Accela — do not create accounts).

---

## Appendix — key endpoints (all public, read-only)
- County ArcGIS root: `https://ocgis4.ocfl.net/arcgis/rest/services?f=json`
- CE (full): `https://ocgis4.ocfl.net/arcgis/rest/services/Public_Dynamic/MapServer/1` (EPD Violation All)
- CE (active): `https://ocgis4.ocfl.net/arcgis/rest/services/Public_Dynamic/MapServer/0` (EPD Active Violation/Open Incidents)
- CE mirror: `https://ocgis4.ocfl.net/arcgis/rest/services/AGOL_Open_Data/MapServer/53` and `/74`
- Permit app (context only, no records): item `cb9d41737de84f01b46b617bd57ac6a8`; web map `a5663f0c46194cf3816a118fb5523044`
- Economic Incentive Permits (niche, not general): `https://services1.arcgis.com/0U8EQ1FrumPeIqDb/arcgis/rest/services/Economic_Incentive_Permits_Updated/FeatureServer/0`
- County org (AGOL): `https://ocfl.maps.arcgis.com` (orgId `0U8EQ1FrumPeIqDb`)
- Dead hosts confirmed: `ocgis1.ocfl.net`, `data.orangecountyfl.net`, `gis.ocfl.net` (all NORESOLVE); `ocpafl.org` REST = Service Unavailable.
