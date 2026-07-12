# Orlando / Orange County, FL — Statewide-Legs Verification (Round 7 probe)

**Date:** 2026-07-12
**Scope:** Read-only research on PUBLIC endpoints only. No logins, payments, registrations, CAPTCHA/Turnstile bypass, form submissions, or outreach. Polite request rates; measured shape + freshness only. Freshness = **MAX RECORD DATE** in the data (never a metadata "modified" timestamp). Findings UNVERIFIED beyond the exact queries/rows shown.

**Key correction up front:** Orange County's DBPR/FDOR numeric county code is **58**, NOT 48. Confirmed independently in two systems (DBPR extract city distribution + FDOR spatial point query both return 58 for Orlando). Do not assume Hillsborough's `39`-style alphabetic offset carries — probe each.

---

## Leg 1 — DBPR contractor/business rolls — **BUILD (GO)**

Same download infra as the alcohol leg. Extract is a public static CSV, no login.

**File / query (exact):**
`https://www2.myfloridalicense.com/sto/file_download/extracts/CONSTRUCTIONLICENSE_1.csv`
Filter: field 12 (county code) == `58` (Orange). Field layout: 1=record-type, 3=licensee name, 4=business name, 6=addr1, 9=city, 11=zip, 12=county code, 15=status(A/I), 17=issue date, 18=expiry, 21=license #.

- **File size / total rows:** 48.2 MB, **268,983 rows** statewide.
- **Orange (code 58) rows:** **11,820** total; **4,646** with status `A` (active). NONZERO confirmed.
- **Business name + address fields present:** yes (fields 4 + 6/9/11).
- **County-code validation:** code 58 city distribution = Orlando (7,175), Winter Park (1,216), Winter Garden (896), Apopka (825), Windermere (468), Maitland (370), Ocoee (290), Belle Isle, Zellwood, Lake Buena Vista — all Orange County municipalities. Code 58 = Orange, confirmed empirically.
- **FRESHNESS (max record date):** max **issue date (field 17) = 07/10/2026** among Orange rows — i.e. the roll was refreshed within ~2 days of this probe. Genuinely live, not frozen. (Max expiry 08/10/2029 is a forward-dated renewal, consistent with fresh issuance.)

**Sample Orange (58) rows:**
| Name | Business | Address | City | Zip | Issue | License |
|---|---|---|---|---|---|---|
| HUTTON, MARK H | HUTTON ENTERPRISES INC | 7009 DR PHILLIPS BLVD | ORLANDO | 32819 | 06/16/2000 | CBC027068 |
| MAJORS, STEPHEN G | MAJOR FLORIDA ENTERPRISES, LLC | 9920 MARSH PONTE DRIVE | ORLANDO | 32832 | 03/14/2023 | CBC027113 |
| CARPENTER, MICHAEL R | C & M CARPENTER CONST CO INC | 1513 ROYAL CIRCLE | APOPKA | 32703 | 06/22/2000 | CBC027131 |

Note: `CONSTRUCTIONLICENSE_1.csv` is the certified/registered *contractor* extract (CBC/CGC/etc). Other DBPR profession extracts live in the same `/extracts/` path if broader business rolls are needed.

---

## Leg 2 — RealAuction (FL tax-deed / foreclosure) — **BUILD (GO)**

Orange County IS on RealAuction. Live hosts (both resolve, banner reads "Orange County Sale"):
- Tax deed: **`https://orange.realtaxdeed.com/`**
- Foreclosure: **`https://orange.realforeclose.com/`**
(Note: hosts 403 to bare `curl`; return 200 with a normal browser User-Agent. Read-only, no login required to view the calendar or sale previews.)

**Upcoming-sale discovery (exact):**
- Calendar: `https://orange.realtaxdeed.com/index.cfm?zaction=USER&zmethod=CALENDAR` (navigate months via `&selCalDate={ts '2026-08-01 00:00:00'}`). Sale days render with CSS class `CALSELT` and a `dayid="MM/DD/YYYY"` attribute.
- Sale preview (parcel list, READ-ONLY, no login): `https://orange.realtaxdeed.com/index.cfm?zaction=AUCTION&Zmethod=PREVIEW&AUCTIONDATE=MM/DD/YYYY`

- **Upcoming sales count:** July 2026 = 0 scheduled tax-deed days. **August 2026 = 4 sale dates:** Aug 6, 13, 20, 27, each 10:00 AM ET. Per-date active/scheduled item counts: 08/06 → 11/28, 08/13 → 13/16, 08/20 → 18/20, 08/27 → 16/16. The 08/06 preview page rendered **25 auction item boxes** without login.
- **FRESHNESS (max record date):** next live sale **08/06/2026** (forward-dated, ~3.5 weeks out) — calendar is current, not stale.

**Shape / columns per parcel** (from 08/06/2026 preview, first item, read-only):
| Field | Value |
|---|---|
| Auction Starts | 08/06/2026 10:00 AM ET |
| Auction Type | TAXDEED |
| Case # | 2019-225 |
| Certificate # | (blank on this row) |
| Opening Bid | $1,474.71 |
| Parcel ID | 212027278400080 |
| Property Address | WHITNEY ST, MOUNT DORA, FL- 32757 |
| Assessed Value | $387.00 |

Columns available: Auction Type, Case #, Certificate #, Opening Bid, Parcel ID, Property Address, Assessed Value, Auction start datetime. (Post-sale bid results appear on the auction-results view once a sale closes.)

**Lands Available:** the dedicated `zmethod=LANDS` path returned only the splash shell in read tests (JS-gated). Orange's Lands Available list is published by the Comptroller/Clerk rather than exposed as a clean RealAuction endpoint — see External Links on the RealAuction left rail (Comptroller `occompt.com`, Clerk `myorangeclerk.com`). Treat Lands Available as a **FLAG for human** to locate the canonical list; not blocking for the upcoming-sale leg.

---

## Leg 3 — Parcel / valuation layer — **BUILD (GO), via FDOR statewide cadastral**

Two candidate statewide layers evaluated:

1. **FDOT statewide Parcels** (`https://gis.fdot.gov/arcgis/rest/services/Parcels/...`) → **GATED.** Returns `{"error":{"code":499,"message":"Token Required"}}`. FLAGGED for human, not worked around.
2. **FDOR Cadastral 2025** (AGOL, public) → **USABLE.** This is the record-level GO.

**Endpoint (exact):**
`https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0`
- Hosting: **ArcGIS Online (AGOL) hosted FeatureServer**, self-serve public, `capabilities: Query,Extract`, maxRecordCount 2000, SR wkid 3086.
- **Layer name / vintage:** "FDOR Cadastral 2025", field `ASMNT_YR = 2025` on live Orange rows → **assessment-year vintage 2025** (the April-2025 DOR PTO submission; layer refreshes annually each August). 10,831,924 parcels statewide.
- 121 fields incl. all needed: `CO_NO, PARCEL_ID, OWN_NAME, DOR_UC` (use class), `PA_UC, JV` (just value), `LND_VAL, LND_SQFOOT, SALE_YR1/SALE_MO1/SALE_PRC1, QUAL_CD1, PHY_ADDR1/PHY_CITY/PHY_ZIPCD, S_LEGAL, ASMNT_YR`.

**Orange County code:** `CO_NO = 58` (SAME code as DBPR — confirmed by point query below returning 58 at a known Orlando parcel).

**Query quirk (documented so the builder doesn't lose a day):** this hosted layer intermittently rejects standalone numeric attribute predicates like `where=CO_NO=58` with a generic HTTP-200 `code 400 "Unable to perform query"`, while **spatial queries (point/envelope), `OBJECTID` predicates, and `where=1=1` succeed reliably.** Build Orange extraction via **spatial filter (county envelope) with `outFields`**, not a raw `CO_NO=58` WHERE. Pagination via `resultOffset`/`resultRecordCount` (2000/page).

**Point query at Mall at Millenia (exact URL):**
```
https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query
  ?geometry=-81.4353,28.4855&geometryType=esriGeometryPoint&inSR=4326
  &spatialRel=esriSpatialRelIntersects
  &outFields=CO_NO,PARCEL_ID,OWN_NAME,DOR_UC,JV,LND_VAL,LND_SQFOOT,SALE_YR1,SALE_PRC1,PHY_ADDR1,PHY_CITY,ASMNT_YR
  &returnGeometry=false&f=json
```
**Returned row:** CO_NO 58 · PARCEL_ID 172329221101000 · OWN_NAME "MILLENIA LAKES OWNER II LP" · DOR_UC 018 · JV $36,687,916 · LND_VAL $12,039,213 · LND_SQFOOT 542,665 · PHY_ADDR1 "5323 MILLENIA LAKES BLVD" · PHY_CITY Orlando · **ASMNT_YR 2025**.

**Envelope query over the Millenia commercial district** (`geometry=-81.45,28.47,-81.42,28.50&geometryType=esriGeometryEnvelope&inSR=4326`, `orderByFields=JV DESC`) — 3 sample commercial rows:
| CO_NO | PARCEL_ID | Owner | DOR_UC | JV | Phys Addr | ASMNT_YR |
|---|---|---|---|---|---|---|
| 58 | 172329546500010 | FORBES TAUBMAN ORLANDO LLC (Mall at Millenia) | 015 | $349,013,473 | 4200 CONROY RD, Orlando | 2025 |
| 58 | 192329284100010 | ORLANDO OUTLET OWNER LLC (Intl Premium Outlets) | 015 | $118,226,423 | 4967 INTERNATIONAL DR, Orlando | 2025 |
| 58 | 172329887600020 | VR NORTHBRIDGE HOLDINGS LIMITED | 003 | $79,090,278 | 4902 MILLENIA BLVD, Orlando | 2025 |

**FRESHNESS (max record date):** `ASMNT_YR = 2025` on every live Orange row returned — 2025 assessment roll, current cycle. (Sale fields SALE_YR1 were 0 on these particular large-owner parcels — expected for long-held institutional holdings; sale history is populated where a recent qualified sale exists.)

**OCPA note:** Orange County Property Appraiser (`ocpafl.org` → app at `ocpaweb.ocpafl.org`) exists and has a parcel search, but its data API sits behind **Azure API Management** (`ocpa-web-api-ams.azure-api.net/api/...`); the SPA routes return only the app shell to anonymous requests and the parcel endpoints are not confirmed callable without a subscription key. Rather than probe a gated/keyed API, **use the FDOR Cadastral layer above** as the record-level source (it carries OCPA-sourced values). If parcel-level *sketches/photos* are later needed, OCPA image endpoints (`ocpaimages.ocpafl.org/api/Image/GetPIDImage?pid=`) are separate and can be re-probed.

---

## Roll-up

**Orange County / Orlando GO status: Leg 1 (DBPR contractors) = GO · Leg 2 (RealAuction tax-deed) = GO · Leg 3 (parcel/valuation via FDOR Cadastral 2025) = GO.** All three confirmed live with the correct county code **58** (not 48); FDOT parcels leg is token-gated (flagged, use FDOR instead) and RealAuction "Lands Available" list is flagged for human sourcing via the Comptroller/Clerk.
