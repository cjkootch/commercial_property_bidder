# FL Permit + Code-Enforcement Rescue Sweep — Tampa Bay Neighbors & Alt Metros

**Date:** 2026-07-11 (research run 2026-07-12)
**Scope:** READ-ONLY research on PUBLIC endpoints only. No logins, payments, registrations, CAPTCHA/Turnstile bypass, form submissions, or outreach. Polite request rates; shape/freshness measured only, no bulk pulls. **All findings UNVERIFIED** — exact URLs, the query that produced them, and sample rows are included. Freshness measured as the **max record date** on the live endpoint (metadata "modified" dates are explicitly NOT trusted — a prior Hillsborough layer looked ideal but was frozen).

**Context (Round 6):** Tampa/Hillsborough permits + 311 confirmed NO-BUILD on open data (Accela SPAs, frozen mirrors). This sweep asks whether Tampa Bay can source its permit/code leg from across the bay (Pinellas/St. Pete/Clearwater), or whether another FL metro should be metro #1. Statewide legs (DBPR/FDOR/RealAuction) are assumed to apply regardless of metro choice.

---

## 1. Pinellas County / St. Petersburg / Clearwater (Tampa Bay's other half — TOP PRIORITY)

### Bounding-box question (answered explicitly)

Proposed Tampa bbox `[-82.8754, 27.5264, -82.0545, 28.1734]` (minLon, minLat, maxLon, maxLat).

Measured Pinellas jurisdictional extent in WGS84 (authoritative, from the county's own layer):
- Query: `https://egis.pinellas.gov/gis/rest/services/PublicWebGIS/Jurisdictions/MapServer/0/query?where=1=1&outSR=4326&returnExtentOnly=true&f=json`
- Result: `xmin -82.854298, ymin 27.610173, xmax -82.576397, ymax 28.173493`

Edge-by-edge containment:
| Edge | Pinellas | Tampa bbox | Inside? |
|---|---|---|---|
| West (minLon) | -82.8543 | -82.8754 | YES |
| East (maxLon) | -82.5764 | -82.0545 | YES |
| South (minLat) | 27.6102 | 27.5264 | YES |
| North (maxLat) | 28.1735 | 28.1734 | **overshoots by 0.00009° (~50 ft)** |

**Verdict on bbox:** The Tampa bbox **already covers Pinellas / St. Pete / Clearwater** on three of four edges. The only gap is a rounding-level sliver (~50 feet) at the extreme north tip (Tarpon Springs / Oldsmar shoreline). Practically it is covered; to be exact, **bump maxLat from 28.1734 → 28.1735**. No meaningful bbox extension is required — Pinellas is inside the current box. So the spatial premise for "rescue from across the bay" holds; the question is whether the *data* exists.

### Building permits — **NO-BUILD**

- **Pinellas County:** permits are served through **Accela** (same SPA trap as Tampa/Hillsborough). ArcGIS service root `https://egis.pinellas.gov/gis/rest/services?f=json` exposes an `Accela` folder, but the layers under it are reference geometry only:
  - Query: `https://egis.pinellas.gov/gis/rest/services/Accela/AccelaAddressParcel/MapServer?f=json` → layers `[0 Address, 1 Parcel, 2 Owner]`. No permit records, no valuation, no issue date. The `Accela/AccelaBldgAreas`, `AccelaMobile`, `AccelaReference` services are likewise map backdrops for the Accela app, not a permit feed.
  - The new open-data hub `https://new-pinellas-egis.opendata.arcgis.com/api/feed/dcat-us/1.1.json` lists **134 datasets**; a keyword scan for permit/code/violation/case returned **only** `Pinellas ZipCode` — i.e. zero building-permit or code datasets. Portfolio is parcels/zoning/flood/infrastructure.
- **St. Petersburg:** no Socrata portal. `data.stpete.org` / `stat.stpete.org` return the CMS 404, not a SODA catalog. The city's GIS hub `https://geohub-csp.opendata.arcgis.com/api/feed/dcat-us/1.1.json` lists **78 datasets**; keyword scan for permit/code/build/inspect/violation returned **only** `City Codes Assistance` (a codes-help reference item, not case-level data). No permit dataset.
- **Clearwater:** ArcGIS root `https://gis.myclearwater.com/arcgis/rest/services?f=json` has no building-permit service (folders are Utilities/Traffic/Parks/EconDev/NeighborhoodServices/ProChamps). Permits run through EnerGov/Accela, not open data.

**Freshness proof:** N/A — no record-level permit endpoint exists to measure. NO-BUILD by absence.

### Code enforcement — **NO-BUILD (frozen)**

- **Clearwater** is the *only* record-level code layer found in Pinellas:
  - Endpoint: `https://gis.myclearwater.com/arcgis/rest/services/ProChamps/CodeViolations_WGS84/MapServer/0` (layer name literally "Acella Active Code Cases")
  - Fields: `CASE_TYPE, CSM_CASENO, STATUS_1, ADDRESS, DESCRIP, PC_PID, OPENDATE, LASTDATE` — good shape (address + free-text DESCRIP + open date).
  - Count query: `.../0/query?where=1=1&returnCountOnly=true&f=json` → **1,337 records**
  - **Freshness query:** `.../0/query?where=1=1&outStatistics=[{"statisticType":"max","onStatisticField":"OPENDATE","outStatisticFieldName":"maxopen"},{"statisticType":"max","onStatisticField":"LASTDATE","outStatisticFieldName":"maxlast"}]&f=json`
  - **Result: max OPENDATE = 2022-03-04, max LASTDATE = 2022-04-27.** **FROZEN ~4 years.** Dead, exactly like the Hillsborough trap — metadata looks live, records stop in 2022.
  - Sample rows (query `...&outFields=CASE_TYPE,STATUS_1,ADDRESS,DESCRIP,OPENDATE&orderByFields=OPENDATE DESC&resultRecordCount=3&f=json`):
    - `BIZ | Active | 2963 GULF TO BAY BLVD 310 | Business operating without business tax receipt | open 2022-03-04`
    - `BIZ | Active | (no address) | Business operating without obtaining a Clearwater business tax receipt | open 2022-03-04`
    - `BIZ | Active | 2963 GULF TO BAY BLVD, UNIT# 120 | Business operating without obtaining a Clearwater business tax receipt | open 2022-03-04`
  - Note: even the top-of-file rows are all `BIZ` (business-tax) cases, no nuisance vocabulary surfaced — and it's frozen regardless.
- Pinellas County and St. Pete expose no code-enforcement case layer at all (hub scans above returned nothing).

**Pinellas metro verdict — permits NO-BUILD, code NO-BUILD.** Pinellas does NOT rescue Tampa Bay's missing legs from across the bay. Every candidate is Accela/EnerGov-gated or frozen (Clearwater 2022). The bbox already covers Pinellas, but there is no open, fresh, record-level permit or code data behind it.

---

## 2. Orlando / Orange County — **DOUBLE BUILD** (both legs live, daily, fresh)

City of Orlando runs a genuine Socrata portal (`data.cityoforlando.net`) with record-level, valuation-bearing, daily feeds. (Orange County's own ArcGIS `ocgis1.ocfl.net` did not respond; the City feed covers Orlando city limits — unincorporated Orange would need separate sourcing.)

### Building permits — **BUILD**
- Endpoint: `https://data.cityoforlando.net/resource/ryhf-m453.json` — dataset "Permit Applications" (`ryhf-m453`), ~1,103,594 rows.
- **Freshness query:** `?$select=max(issue_permit_date),max(processed_date),count(1)` → **max issue_permit_date = 2026-07-10 (2 days before today).** NOT frozen. Daily cadence confirmed (Jul 6–10 issued/day: 119, 119, 191, 107, 130; low July 4 holiday count = natural pattern).
- Valuation field: `estimated_cost`. Commercial/residential discriminator: `plan_review_type` (Commercial 324,589 | Residential 1/2 499,626 | Residential 3+ 106,727 | none 172,652). Address: `permit_address`. Filter `issue_permit_date IS NOT NULL` to isolate truly issued permits.
- Sample rows (`?$where=issue_permit_date IS NOT NULL&$order=issue_permit_date DESC&$limit=3`):
  - `BLD2026-15533 | Repair | Residential 1/2 | est_cost 29,210 | 2026-07-10 | 1701 BIMINI DR`
  - `BLD2026-12519 | Alteration | Commercial | est_cost 15,000 | 2026-07-10 | 4520 36TH ST`
  - `FLO2026-10107 | FloodPlain/ElevCert | Residential 1/2 | est_cost 0 | 2026-07-10 | 11341 SPLIT OAK LN`

### Code enforcement — **BUILD**
- Endpoint: `https://data.cityoforlando.net/resource/k6e8-nw6w.json` — "Code Enforcement Cases" (`k6e8-nw6w`), ~254,652 rows.
- **Freshness query:** `?$select=max(casedt),max(resdt),count(1)` → **max casedt = 2026-07-11 (yesterday).** NOT frozen. Daily cadence (Jul 6–11: 98, 87, 46, 73, 113, 16/day).
- Fields: `apno, case_type, code (workflow status), case_comments (free-text), casedt, resdt, caseinfostatus, derived_address, parcel_id, parassdvalue`.
- Nuisance vocabulary: NOT a coded field. `case_type` gives broad buckets — **Lot 36,946** (overgrowth/grass), **Pool 677** (green/stagnant), Housing 37,001 (dangerous structure lives here), Tree 1,690, Abatement 2,341, Commercial 4,348. Specific words (overgrown, debris, green pool) live in free-text `case_comments` — match via `case_type in('Lot','Pool')` + `$q=overgrown`/`$q=debris`.
- Sample rows (`?$where=case_type in('Lot','Pool')&$order=casedt DESC&$limit=3`):
  - `2026-11878LOT | Lot | 2026-07-10 | 5201 LOBELIA DR | comments "overgrown yard" | Open`
  - `2026-11873LOT | Lot | 2026-07-10 | 219 E MARKS ST | comments "Overgrown yard this office building..." | Open`
  - `2026-11888LOT | Lot | 2026-07-11 | 1017 BROCKWAY AVE | Open`
- Caution: catalog cross-lists code datasets from OTHER cities (NOLA, Cincinnati, Norfolk, Chicago — `3ehi-je3s`, `cncm-znd6`, `mxtv-99gh`, `22u3-xenr`). Use only `k6e8-nw6w` for Orlando.

**Orlando verdict — permits BUILD (val + comm/res + daily, 2 days old), code BUILD (nuisance buckets + free-text, 1 day old).**

---

## 3. Broward / Fort Lauderdale — **DOUBLE NO-BUILD**

No usable Fort Lauderdale Socrata (`data.fortlauderdale.gov/api/catalog/v1?q=permit` empty). Broward county-wide hosts (`bcgis.broward.org`, `gis.broward.org`, `data-broward.opendata.arcgis.com`, `data.broward.org`) and Hollywood/Pompano fallbacks all returned empty/unresolved this pass. Only live source was Fort Lauderdale's ArcGIS.

### Building permits — **NO-BUILD** (frozen + no valuation)
- Endpoint: `https://gis.fortlauderdale.gov/arcgis/rest/services/BuildingPermitTracker/BuildingPermitTracker/MapServer/0` ("Building Permits"), 204,760 records.
- **Freshness query:** `.../0/query?where=1=1&outStatistics=[{"statisticType":"max","onStatisticField":"SUBMITDT","outStatisticFieldName":"m"}]&f=json` → **max SUBMITDT = 2026-03-16 (~4 months stale).** Dense tail up to the max (164 rows on 03-16) = a live feed that stopped syncing, not a one-time dump. Do NOT trust `LASTUPDATEDATE`/`SYNCDATE` — they return junk future dates (2030-01-16).
- Disqualifiers beyond staleness: `ESTCOST IS NOT NULL` count = **0** (valuation 100% empty); `USECLASS IS NOT NULL` = 4,271 (~2%, discriminator near-empty).
- Sample (orderBy SUBMITDT DESC): `MEC-GEN-2603 | Mechanical | 2026-03-16 | 3333 NE 34 ST | ESTCOST null | USECLASS null`; `PLB-GEN-2603 | Plumbing | 2026-03-16 | 2701 N OCEAN BLVD #9D | null | null`; `BLD-RENEWAL | 2026-03-16 | 4600 NE 23 AVE | null | null`.

### Code enforcement — **NO-BUILD** (frozen ~7 yrs, no nuisance vocab)
- Endpoint: `https://gis.fortlauderdale.gov/arcgis/rest/services/CodeCaseTracker/CodeCase/MapServer/0` ("Code Cases"), 66,436 records.
- **Freshness query:** `.../0/query?where=1=1&outStatistics=[{"statisticType":"max","onStatisticField":"INITDATE",...}]&f=json` → **max INITDATE = 2019-10-03 (~7 years frozen).** created/last_edited maxes are null (no alternate signal).
- `CASETYPE` is generic ("Complaints" / null) — no overgrowth/debris/dangerous-structure/green-pool taxonomy.
- Sample (orderBy INITDATE DESC): `9504452 | null | 6741 NW 28 AV | 2019-10-03`; `CE19100242 | Complaints | 2512 NW 20 ST | 2019-10-03 | Open`; `CE19100246 | Complaints | 1750 NE 12 ST | 2019-10-03 | Open`.

**Broward verdict — permits NO-BUILD (stale Mar-2026 + empty ESTCOST), code NO-BUILD (frozen 2019, no vocab).** Correct Broward county-wide GIS host not confirmed — FLAG for a re-probe if Broward is ever prioritized.

---

## 4. Jacksonville / Duval (COJ) — **DOUBLE NO-BUILD** (data exists, but firewalled)

Task's assumed hosts are wrong: `data.coj.net` / `data.jacksonville.gov` fail DNS (no Socrata); `maps.coj.net/arcgis/rest/services` → 404. Real org is AGOL **"JaxGIS"** (orgid `NXfNVaFp7QMxnE3j`), public host `https://services1.arcgis.com/NXfNVaFp7QMxnE3j/arcgis/rest/services` (87 services, reachable) plus on-prem `gisportal.coj.net/server`.

### Building permits — **NO-BUILD**
- Enumerated all 87 public services on `services1.arcgis.com/NXfNVaFp7QMxnE3j` and paged the full org catalog (`https://www.arcgis.com/sharing/rest/search?q=orgid:NXfNVaFp7QMxnE3j (type:"Feature Service")&sortField=modified&sortOrder=desc`). **No building-permit layer exists** — public or otherwise. Permits run only through the non-open Accela/"Online Services" lookup app.
- False positives rejected: `services6.arcgis.com/ONZht79c8QWuX759/.../Building_Permits` = Region of Peel/Caledon, Ontario (not FL); other "Duval permit" hits = Dublin OH, Duvall WA, USACE, FDEP.

### Code enforcement — **NO-BUILD** (exists but not queryable)
- Nuisance layers DO exist as `access: public` AGOL items (owner jaxgis, MCCD Ch. 518/741), modified 2025-10-07: `Nuisance_Yard` (`fb949746f1c74628b756b8cb956bd704`), `Litter_all`, `Litter_IllSigns`, `Litter_MainRep`, `Litter_NucGraffiti`, `Right_of_Way`, plus `_Cluster` variants — correct vocabulary.
- **But every service URL points to `https://gisportal.coj.net/server/rest/services/Hosted/<name>/FeatureServer`, which returns HTTP 404 to anonymous external callers.** Metadata (layer, `/query?where=1=1&returnCountOnly=true`) all 404 — **freshness CANNOT be measured, no rows pullable.** The "modified 2025-10-07" is metadata-only — exactly the signal the task warns not to trust. Legacy 2017 one-offs (`Unsafe_Struc_20170125`) on `services.arcgis.com/zvANyyFOq1BJZHtK` are stale/empty.

**Duval verdict — permits NO-BUILD (no layer at all), code NO-BUILD (data firewalled behind gisportal, 404 external).** FLAG for human: COJ code-compliance data is fresh and correctly structured but published only on an unexposed on-prem server; access would require a public-records request or COJ exposing those Hosted services — no open-data target qualifies.

---

## Build-order recommendation

| Metro | Building permits | Code enforcement | Freshness proof (max record date) |
|---|---|---|---|
| **Orlando / Orange (city)** | **BUILD** | **BUILD** | permits 2026-07-10; code 2026-07-11 |
| Pinellas / St.Pete / Clearwater | NO-BUILD (Accela/EnerGov) | NO-BUILD (Clearwater frozen) | Clearwater code max 2022-03-04 |
| Broward / Ft. Lauderdale | NO-BUILD (stale + empty val) | NO-BUILD (frozen) | permits 2026-03-16; code 2019-10-03 |
| Jacksonville / Duval | NO-BUILD (no layer) | NO-BUILD (firewalled 404) | not measurable (gisportal 404) |

**Recommended metro #1: Orlando / Orange County.** It is the only metro in this sweep with BOTH legs live, record-level, valuation-bearing, and daily-fresh (permits 2 days old, code 1 day old) on a genuine open Socrata portal — Houston-grade on both legs. Build order: (1) stand up Orlando permits `ryhf-m453` + code `k6e8-nw6w`; (2) layer the statewide legs (DBPR/FDOR/RealAuction), which apply to Orlando unchanged; (3) treat unincorporated Orange County as a later expansion (City feed = Orlando city limits only; `ocgis1.ocfl.net` needs a re-probe).

## KEEP-TAMPA vs RE-PICK verdict

**RE-PICK — make Orlando / Orange County metro #1.**

Rationale, made explicit per the brief:
- **Pinellas does NOT rescue Tampa Bay.** The bbox already covers Pinellas/St.Pete/Clearwater (only a ~50 ft northern sliver missing — bump maxLat to 28.1735 and it's exact), so the "extend the bbox across the bay" fix is spatially trivial — but there is **no data behind the box**: Pinellas & St. Pete permits are Accela/EnerGov (no record feed), the only Pinellas code layer (Clearwater ProChamps) is **frozen at 2022-03-04**, and neither county exposes a code-case dataset. Both Tampa-side legs stay NO-BUILD; adding Pinellas adds parcels/zoning, not the two missing legs. So "keep-Tampa-and-extend-bbox" fails on data, not geometry.
- **Orlando clearly beats Tampa on exactly the two missing legs** — permits (valuation + commercial discriminator + daily, 2 days old) and code enforcement (nuisance buckets Lot/Pool/Housing + free-text, 1 day old) — while the statewide legs (DBPR / FDOR / RealAuction) still apply unchanged. Broward and Duval do not rescue anything either (both double NO-BUILD).

**Call: RE-PICK to Orlando / Orange County as metro #1.** Keep Tampa/Pinellas only as a future statewide-leg market if a fresh permit/code source ever opens; do not block on extending the Tampa bbox.
