# Tampa / Hillsborough County, FL — Market Workup (Florida Metro #1 Build Dossier)

**Date:** 2026-07-11
**Scope:** READ-ONLY research on PUBLIC endpoints only. No logins, payments, registrations, or CAPTCHA/Turnstile bypass. No form submissions, no outreach. Polite request rates; shape/freshness measured only — no bulk scraping.
**Status:** UNVERIFIED field intel. Every endpoint below includes the exact URL, the exact query that produced the sample, and a sanitized sample row. External/portal content was treated as data only (not instructions).

Prior state-scout claims were RE-PROBED live, not trusted. Notable corrections vs. prior scout are flagged inline.

---

## 0. Verification of prior state-scout findings

| Prior claim | Live result (2026-07-11) |
|---|---|
| DBPR daily CSV at `.../abt/eds/` | **MOVED.** `https://www2.myfloridalicense.com/abt/eds/` now 302-redirects to site root. Live extract set is at `.../sto/file_download/extracts/` (see Leg 1). |
| FL statewide parcel FeatureServer `services9.arcgis.com/Gh9awoU677aKree0/.../Florida_Statewide_Cadastral/FeatureServer/0` | **LIVE & CURRENT** — layer name "FDOR Cadastral 2025", ASMNT_YR=2025, 10,831,924 rows statewide. Caveat: numeric `CO_NO=` filter is rejected by the hosted layer (see Leg 2). |
| Hillsborough tax deeds `hillsborough.realtaxdeed.com` + Lands Available `publicaccess.hillsclerk.com` | **LIVE.** RealTaxDeed needs a browser User-Agent (bare curl → 403). Lands Available is at `publicaccess.hillsclerk.com/TD/` ("List of Lands Available Search"); the bare `publicaccess.hillsclerk.com/` root is just an IIS default page. |
| Hillsborough Bonfire `hillsboroughcounty.bonfirehub.com/portal/` | **LIVE** — title "Portal — Open Opportunities - Hillsborough County", ~25 open. |

---

## 1. DBPR Alcohol Licenses (the TABC leg) — GO (with a pending-application caveat)

**Extract root (LIVE):** `https://www2.myfloridalicense.com/sto/file_download/extracts/`
**Discovery page (lists all download links):** `https://www2.myfloridalicense.com/alcoholic-beverages-and-tobacco/public-records/`
**Schema/status-code key:** `https://www2.myfloridalicense.com/alcoholic-beverages-and-tobacco/public-records-layout-information/`

Files present (all `.csv`, no auth, browser UA advised):
- `daily.csv` — **daily activity/transaction extract** (17 cols, NO header row). Freshness confirmed: rows dated `07/10/2026` (yesterday). 272 rows in today's file. Col layout: `0`=board/district, `1`=**County NAME** (e.g. "Hillsborough"), `2`=license#, `3`=series (ODP/TWD…), `5`=DBA, `6`=owner, `7-9`=premises addr, `10`=**City**, `11`=state, `12`=zip, `13`=action date, `14`=action code, `15`=**action description**. Action descriptions include `Application Approval`, `Issue Permanent License (From Temp)`, `Stand Alone Permanent Licensure`, `Add a Spirit`. This is the closest thing to a "new license / new-application activity" feed.
- `bd400lic.csv` — **MASTER licensee snapshot.** 45 MB, 219,946 rows, **29 columns WITH header row.** This is the active-license universe.
- `bd4001lic.csv` … `bd4014lic.csv` — per-**profession/series** slices (e.g. bd4001 = profession 4001 wholesale distributors). NOT geographic slices.
- `bdTOBlic.csv`, `bd400revok.csv`, `abtbrands.csv`.

**Full schema (bd400lic.csv / district files, 29 cols):**
`Board, Profession, Owner Name, Series, Modifier, Mail Address 1/2/3, Mail City, Mail State, Mail ZIP, Mail County, DBA, Location Address 1/2/3, Location City, Location State, Location ZIP, Location County, License Number, Primary Status, Secondary Status, Original Licensure Date, Effective Date, Expiration Date, Tax Stamp Designation, Smoking Designation, Retail Tobacco Indicator`

**Pending vs. active — the field:** `Primary Status` (col 21). Per the layout key:
- **`10` = Applicant – Application In Process** ← the "pending / new application" signal
- **`20` = Current** (active license)
- `21` = Temp Certificate, `41` = Escrow, `42` = Suspended, `61` = Revoked, `11` = Withdrew, `12` = Expired-application, etc.

**CAVEAT (measured, important):** The public master (`bd400lic.csv`) is a near-pure **status-20 snapshot** — of 219,946 rows the Primary-Status distribution is `20`=219,076, `41`=510, `21`=354, `42`=6. **Status-10 (in-process applications) essentially do not surface in the public master extract.** New-license *activity* is instead visible in `daily.csv` (via "Application Approval" / "Stand Alone Permanent Licensure" action rows). Net: for a true pending-pipeline feed, `daily.csv` is the leg — the master gives you the standing inventory, not the pipeline.

**Premises-address quality:** GOOD — discrete Location Address 1/2/3, City, State, ZIP, County. Distinct from mailing address.

**Hillsborough / Tampa filter — YES.**
- In `bd400lic.csv`: **Location County = `39`** (numeric code) is Hillsborough. Confirmed by cross-ref: 3,289 of 3,293 `Location City = TAMPA` rows carry county code `39`; the license-number prefix also embeds it (`BEV39…`). Filter: `Location County == 39` OR `License Number LIKE 'BEV39%'`.
- In `daily.csv`: filter col `1` == `Hillsborough` (name).

**Hillsborough inventory (bd400lic.csv, county=39):** **4,578 alcohol/tobacco license rows.** By series: 2APS 989, **4COP 910** (full-liquor consumption-on-premises), **2COP 645** (beer/wine on-premises), RTPD 586, LQS 576 (package), OPS 154, 3PS 139, 1APS 110, ODP 74. Primary Status: 20=4,512 / 41=43 / 21=22 / 42=1.

**ONE sanitized sample row (bd400lic.csv, Hillsborough active on-premises license):**
```
Owner: N******** (redacted) | Series: 2COP | DBA: JASMINE THAI RESTAUR...
Location Addr: 13248 N DALE MABRY HWY, TAMPA 33618 | Location County: 39
License #: BEV390**** | Primary Status: 20 (Current) | Effective: 08/02/2002 | Expires: 09/30/2026
```
Exact query: `curl -A "Mozilla/5.0" .../extracts/bd400lic.csv` then filter col19=='39' & col16=='TAMPA' & col3 in (4COP,2COP,LQS) & col21=='20'.

**Daily-feed sample (daily.csv, Hillsborough, 07/10/2026):**
```
County: Hillsborough | License: 3900986 | Series: TWD | Business: TOBACCO WORLD WHOLESALE LLC
Premises: 101 S SAINT CLOUD AVE, VALRICO FL 33594 | Action date: 07/10/2026 | Action: "Versa Online Active License Print"
```

---

## 2. Hillsborough Parcels — GO (two complementary layers; use both)

Two viable sources; they are complementary because neither alone has both owner-geometry AND value/use-code.

### 2a. County-hosted HCPA (Property Appraiser) — PRIMARY for owner + sales + geometry
**Endpoint:** `https://gis.hcpafl.org/arcgis/rest/services/Webmaps/HillsboroughFL_WebParcels/MapServer/0`
- Self-hosted ArcGIS Server 10.81 (NOT AGOL). SR 102100/3857. maxRecordCount 1000. Layer name `WebParcels_NonConfidential`.
- **Fields:** `folio, strap, DisplayStrap, NameLabel, Owner1, Owner2, TopSaleDate, TopSalePrice, StreetLabel, FullAddress, StreetLevelURL, SiteCity, SiteZip, Homestead, Confidential, ShapeArea`.
- **Has:** owner (Owner1/Owner2), most-recent sale (date + price), full site address, geometry. **Lacks:** assessed value (JV) and DOR use-code — for those use 2b.
- Companion layers in same folder: `HillsboroughFL_SalesPoints`, `HillsboroughFL_ParcelCentroids`, `HillsboroughFL_WebParcels`.
- **Freshness:** live commercial sales dated `2025-12-31` observed (e.g. 4919 W Laurel St, $3.18M) — current.

**Point-query test (International Plaza mall area, 2223 N West Shore Blvd — note site stores "WEST SHORE" as two words):**
Exact query (spatial envelope, more reliable than LIKE):
```
.../MapServer/0/query?geometry=-82.528,27.955,-82.522,27.962&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=folio,Owner1,FullAddress,SiteCity,SiteZip,TopSaleDate,TopSalePrice&returnGeometry=false&f=json
```
Returned rows (sample):
```
folio 1109670010 | HILLSBOROUGH COUNTY AVIATION AUTHORITY | 2223 N WEST SHORE BLVD, TAMPA 33607   ← International Plaza ground parcel (Aviation Authority owns fee; mall is leasehold)
folio 1120280100 | ALNIKA 4919 LLC | 4919 W LAUREL ST, TAMPA | sale 2025-12-31 $3,180,000
folio 1120290200 | ALNIKA 4913 LLC | 4913 W LAUREL ST, TAMPA | sale 2025-12-31 $4,500,000
```
Full row for the mall folio (`where=folio='1109670010'&outFields=*`): strap `182917ZZZ000005476201A`, DisplayStrap `A-17-29-18-ZZZ-000005-47620.1`, Homestead NO, Confidential NO, ShapeArea 388,892 (sq ft, ~8.9 ac).

### 2b. Statewide FDOR Cadastral — for VALUE (JV) + DOR use-code
**Endpoint:** `https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0`
- Layer "FDOR Cadastral 2025" (AGOL-hosted), **ASMNT_YR = 2025**, 10,831,924 rows statewide, SR 3086 (Albers), maxRecordCount 2000, geometry polygon.
- **Rich DOR schema:** `CO_NO, PARCEL_ID, ASMNT_YR, DOR_UC, PA_UC, JV, JV_HMSTD, AV_SD, LND_VAL, LND_SQFOOT, TOT_LVG_AR, ACT_YR_BLT, OWN_NAME, SALE_PRC1/2, SALE_YR1/2, SALE_MO1/2, OR_BOOK1/2, OR_PAGE1/2, QUAL_CD1/2` … (full FDOR NAL layout).
- **CO_NO for Hillsborough = 29** (FDOR alphabetical county numbering; e.g. CO_NO 11 = Alachua, confirmed by Gainesville/Shands/UF owners).

**IMPORTANT CAVEAT (measured):** this hosted layer **rejects numeric equality/BETWEEN on `CO_NO`** — `where=CO_NO=29`, `CO_NO BETWEEN 28.5 AND 29.5`, and even `returnCountOnly` on that predicate all return HTTP 400 "Invalid query parameters." Also, including `CO_NO` or `LND_SQFOOT` in `outFields` of a *spatial* query breaks it. **Workaround that WORKS: spatial envelope query with a JSON geometry object** (do NOT put CO_NO in outFields). Because of this the per-county row count could not be pulled via attribute filter; use spatial extent (bbox in Leg 6) to bound Hillsborough.

**Point-query test (same International Plaza / Westshore envelope):**
Exact query (POST, `--data-urlencode`):
```
geometry={"xmin":-82.528,"ymin":27.955,"xmax":-82.522,"ymax":27.962,"spatialReference":{"wkid":4326}}
geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects
outFields=OWN_NAME,DOR_UC,JV,ASMNT_YR,PARCEL_ID&returnGeometry=false&f=json
```
Returned 38 features; sample rows (PARCEL_ID prefix `1829…` = Hillsborough sec-twp-rng, matches HCPA strap):
```
OWN_NAME: BQ 1810 WESTSHORE LLC        | DOR_UC 016 (community shopping ctr) | JV $9,537,400  | ASMNT_YR 2025
OWN_NAME: WESTSHORE LAUREL LLC         | DOR_UC 018 (office, multi-story)    | JV $4,833,800  | ASMNT_YR 2025
OWN_NAME: GULF COAST HOSPITALITY TAMPA | DOR_UC 039 (hotel/motel)            | JV $5,761,300  | ASMNT_YR 2025
OWN_NAME: EDGEWOOD GENERAL PARTNERSHIP | DOR_UC 048 (warehouse/dist term.)   | JV $4,039,800  | ASMNT_YR 2025
```
Value, use-code, owner, assessment-year all present and current (2025).

---

## 3. Tax Deeds — GO (RealAuction + clerk Lands-Available, both public)

### RealAuction pipeline
**Endpoint:** `https://hillsborough.realtaxdeed.com/` (RealForeclose/RealTaxDeed platform). Bare curl → 403; **works with browser User-Agent.**
- Calendar: `.../index.cfm?zaction=USER&zmethod=CALENDAR` → title "RealForeclose- Hillsborough County -Auction Calendar."
- **Scheduled sale dates parsed from calendar:** 07/09/2026, **07/16/2026, 07/23/2026** (upcoming). Sales run Thursdays 10:00 a.m. (per Tax Collector).
- Per-auction item detail (`zaction=AUCTION&Zmethod=PREVIEW&AUCTIONDATE=MM/DD/YYYY`) returns HTTP 200 but items render via JS/AJAX — item-level counts require a headless session (not pulled; boundaries).

### Lands Available list (clerk-hosted) — measured with a public browser session
**Endpoint:** `https://publicaccess.hillsclerk.com/TD/` — "Hillsborough County List of Lands Available Search" (clerk-hosted Angular/OBPA app; also linked from `https://www.hillsclerk.com/taxdeeds`).
- **Public without login.** Search form fields: From Date, To Date, Case Status, Auction Date, File #, Folio #.
- **List columns:** `File #, Folio #, Auction Date, Certificate #, Case Status, Opening Bid, Winning Bid, Document Type`.
- **Shape/count measured:** a 3-yr window (07/11/2023–07/11/2026) returned **307+ rendered rows and hit the display cap** ("There are more results than what is displayed. Please narrow your search criteria.") — i.e. the full lands-available + tax-deed corpus for the window is large (hundreds).
- **Sample rows (public):**
```
File 2026-462 | Folio 0411040100 | Auction 7/9/2026 | Cert 2023/3864  | SOLD | Open $2,627.39 | Win $25,200 | TD - Tax Deed
File 2026-457 | Folio 1992890000 | Auction 7/9/2026 | Cert 2023/16131 | SOLD | Open $8,202.43 | Win $60,100 | TD - Tax Deed
(pending pipeline) Folio 1789620000 | Cert 2024/15896 | TD - O&E Report / TD - Tax Collector App (DR512) / TD - Tax Collector Cert (DR513)
```
Certificate vintage 2023–2024, auctions dated July 2026 → current, actively updated. Related clerk apps: `.../TR/`, `.../br199/`.

---

## 4. Clerk Recorder (Official Records) — GO (public, date + doc-type search, clerk-hosted)

**Platform:** **CLERK-HOSTED custom app** ("OBPA" / ORI Public Access — jQuery 3.4.1 + jsGrid 1.5.3 + bootstrap-datepicker + chosen; served from clerk infrastructure). **NOT** Acclaim/Kofile/GovOS/Tyler — this is the Hillsborough Clerk's own build (©2026 Victor D. Crist, Clerk of Circuit Court & Comptroller).

**Endpoint:** `https://publicaccess.hillsclerk.com/oripublicaccess/` — title "Official Records Public Search | Hillsborough County Clerk of Circuit Courts." (Also reachable via `pubrec6.hillsclerk.com/ORIPublicAccess/`.)
- **Public without login: YES.** Search UI is a client-rendered jsGrid SPA.
- **Recorded-date-range + deed doc-type search: YES** — the app ships a bootstrap-datepicker (from/to date range) and a `chosen` multi-select (document-type list), i.e. both a recorded-date range and document-type (deed etc.) filter are exposed in the public form.
- **Certified-through freshness:** the form/results render fully client-side from an AJAX data service; a specific "certified through" date string was not exposed in the static HTML (would need a live search render to read — not pulled under read-only boundaries). Note the app is actively branded ©2026, and the sibling Lands-Available app returns 2026 records, so the index is current-year live.
- The bare host `publicaccess.hillsclerk.com/` is only an IIS default page — do not cite it as the portal; the app lives under `/oripublicaccess/`.

---

## 5. Procurement — GO (Bonfire live; two more agencies on OpenGov)

**Bonfire (now branded "Euna Procurement"; `*.bonfirehub.com` tenant URLs still resolve):**

| Tenant URL | HTTP | Live? | Open | Platform |
|---|---|---|---|---|
| `hillsboroughcounty.bonfirehub.com/portal/` | 200 | YES | **~25 open** | Bonfire/Euna |
| `gohart.bonfirehub.com/portal/` (HART transit) | 200 | YES | **1 open** (RFP-55218 CNG Bus Natural Gas Fuel) | Bonfire/Euna |
| `tampa.` / `cityoftampa.` / `hart.` / `sdhc.` / `hillsboroughschools.` / `tampaairport.` / `hcaa.` .bonfirehub.com | NXDOMAIN | no | — | (slugs do not exist) |

**Other agencies (NOT on Bonfire):**
| Agency | Platform | Portal | Open |
|---|---|---|---|
| **City of Tampa** | **OpenGov** | `procurement.opengov.com/portal/cityoftampa` | **~10 open** |
| **Tampa International Airport (HCAA)** | **OpenGov** | `procurement.opengov.com/portal/tampaairport` (legacy `secure.procurenow.com/portal/tampaairport`) | **~5 open** |
| **Hillsborough County Public Schools** | **DemandStar** | `demandstar.com` (agency: Hillsborough County Public Schools) | not counted |

Notes: no public JSON/REST API is exposed on the Bonfire or OpenGov portals (`/api/...` → 404); opportunity lists render client-side. Counts came only from public opportunity lists — no logins touched. **Live procurement leg for this market spans 4 platforms:** Bonfire (County + HART), OpenGov (Tampa + Airport), DemandStar (Schools).

---

## 6. bbox proposal — `tampa` market entry (FIRST non-Texas bbox; no TX neighbors to collide with)

Data-driven from the HCPA parcel-layer extent (converted 3857→WGS84):

```
tampa: [-82.8754, 27.5264, -82.0545, 28.1734]      # [west, south, east, north]
```

Covers all of Hillsborough County (Tampa, Brandon, Plant City, Riverview, Valrico, Ruskin). West edge sits in Tampa Bay/Old Tampa Bay (county water boundary); east edge at the Polk County line. No Texas market bboxes are adjacent, so no collision handling needed. If a tighter urban-core box is preferred for the first pass, an inset `[-82.60, 27.85, -82.35, 28.05]` isolates Tampa/Westshore/Ybor/airport without the rural south county.

---

## 7. Quick-compare — does Orlando/Orange or Fort Lauderdale/Broward beat Tampa on any single leg?

Same statewide rails apply to all three FL metros, so the legs are near-identical in *availability*; the question is volume/quality per leg:

- **DBPR alcohol:** identical mechanism statewide (same `daily.csv` + `bd400lic.csv`, filter by Location County code — Orange and Broward each just a different numeric code). No metro has a structural edge; Broward/Dade have higher raw license counts but same schema. **Tie.**
- **Parcels:** all three counties self-host strong ArcGIS PA layers (Orange OCPA, Broward BCPA) with owner+value+sales, plus the same FDOR 2025 statewide layer. **Tie** on data; BCPA (Broward) arguably has the richest single-layer value+use-code combo, but not "badly enough" to reconsider.
- **Tax deeds:** all three use RealAuction (`orange.realtaxdeed.com`, `broward.realtaxdeed.com`) + clerk Lands-Available. **Tie.**
- **Clerk records:** Orange & Broward run larger, more polished recorder portals, but Hillsborough's public date+doc-type search is fully adequate. **Slight edge elsewhere, not decisive.**
- **Procurement:** Broward is procurement-dense (County + BCPS + Port Everglades + FLL airport + BCT transit), and Orange has Orange County + Orlando + OUC + GOAA (airport) + Lynx. Both plausibly carry **more open solicitations** than Tampa's Bonfire+OpenGov mix — this is the one leg where a bigger metro measurably out-volumes Tampa.

**Verdict:** No single leg is *badly* beaten. The only leg where Orlando/Broward clearly out-volume Tampa is **procurement breadth**, and that's a "more of the same platforms" difference, not a capability gap. Tampa/Hillsborough holds up as the FL metro-#1 pick: every leg is live, public, and current-vintage (2025 assessments, 2026 deed auctions, yesterday-dated DBPR activity). **KEEP Tampa as metro #1.**
