# Permit + 311 signal expansion — DFW, San Antonio, Austin (2026-07-10)

Read-only public-endpoint recon (Task 7). Findings are **unverified** — re-probe live before wiring.
Goal: new signal TYPES in metros we already sell. Houston runs four feeds; Dallas/SA/Austin two each.
For each city: building-permits open-data endpoint (can we express Houston's `minCost + commercial + recency`?)
and code-violations/311 (which case types imply forced property maintenance).

---

## San Antonio
**Platform:** CKAN ("Open Data SA", `data.sanantonio.gov`) — full PostgreSQL via `datastore_search_sql`, **no API key** (anonymous 200s).

### Building permits
- Dataset "PERMITS ISSUED", resource `c21106f9-3ef5-4f3a-8604-f992b4db7512` (125,516 rows). Refreshed ~monthly (max DATE ISSUED 2026-07-02).
- Cost `DECLARED VALUATION` (text→CAST FLOAT, nulls on trade sub-permits); work `WORK TYPE`; **commercial discriminator** = `PERMIT TYPE` prefix `Comm`/`Res`; issue `DATE ISSUED` (ISO). Address string good; coord columns mixed WGS84/State-Plane → geocode from address.
- **Houston-style filter — YES (verified):** `...datastore_search_sql?sql=SELECT ... FROM "c21106f9-..." WHERE "PERMIT TYPE" LIKE 'Comm%' AND CAST("DECLARED VALUATION" AS FLOAT) > 500000 AND "DATE ISSUED" >= '2026-06-01' ORDER BY "DATE ISSUED" DESC` → top row Comm New Building $565k, issued 2026-07-02.

### Code violations / 311
- "311 Service Calls", resource `20eb6d22-7eac-425a-85c1-fdb365fd3cd7` (517,923 rows, rolling 365 days, `last_modified` 2026-07-05).
- Three-level vocab `Dept › REASONNAME › TYPENAME`; code enforcement = `Dept='Development Services' AND REASONNAME='Code Enforcement'`. **Richest forced-maintenance vocabulary of the five cities:** `Overgrown Yard/Trash` (+vacant-lot/alley variants) = high weeds; `Illegal Dumping`; `Graffiti (Private Property)`; `Dangerous Premise BSB Processed` / `Property Structure Concerns`. Status OPEN/CLOSED + timestamps. Address in `OBJECTDESC`; coords State-Plane feet.
- Gap: no stagnant-water code type (routes to Metro Health). Flag: confirm the Nov-2025 maintenance-freeze banner cleared.

**San Antonio verdict:** GREEN — both legs clean, open SQL, commercial+minCost+recency + granular violation types all directly expressible. Best 311 signal of the set.

---

## Austin
**Platform:** Socrata (`data.austintexas.gov`), anonymous OK (free app token → FLAG for human if production polling needs higher limits; do not self-register).

### Building permits
- `3syk-w9eu` "Issued Construction Permits" — **daily** (`rowsUpdatedAt` today; max issue_date 2026-07-10).
- Cost `total_job_valuation` (BP permits carry full value; trade permits often blank); work `work_class`/`permit_type_desc`; **commercial discriminator** = `permit_class_mapped` ∈ {Commercial, Residential} (clean); issue `issue_date` + prebuilt `issued_in_last_30_days`. Clean `original_address1` + lat/long/point.
- **Houston-style filter — YES (verified):** `...3syk-w9eu.json?$where=permit_class_mapped='Commercial' AND total_job_valuation>500000 AND issued_in_last_30_days='Yes'&$order=issue_date DESC` → e.g. `2026-068707 BP | 2026-07-02 | Commercial | New | $25,000,000 | 6801 NORTHEAST DR`.

### Code violations / 311
- `6wtj-zbtb` "Austin Code Complaint Cases" (~82,800 rows, daily, max opened_date 2026-07-11). No separate 311 dataset (links via `servicerequestnumber`).
- **Caveat:** `case_type` is flat ("Complaints"). Discriminator is `description` with only **4 coarse buckets**: Property Abatement (weeds/dumping/graffiti/water lumped), Structure Condition Violation(s), Land Use Violation(s), Work Without Permit. Granular sub-type (weeds vs dumping vs graffiti) is NOT a column — requires following per-case `violationcaselink`. **FLAG for human.** Status Active/Closed/Pending; address + lat/long good.

**Austin verdict:** GREEN — cleanest API and daily-fresh permits; 311 usable only at the 4-bucket level (granular nuisance type needs per-case drill-down).

---

## Fort Worth
**Platform:** MIGRATED off Socrata → **ArcGIS Hub** (`open-data-cfw.hub.arcgis.com`, host `services5.arcgis.com/3ddLCBXe1bRt7mzj`). Old Socrata ids `quz7-xnsy`/`spnu-bq4u` are DEAD (catalog still indexes them — do not build against them). No key needed.

### Building permits
- `CFW_Open_Data_Development_Permits_View/FeatureServer/0` (1,599,668 rows; latest File_Date 2026-07-10, ~daily). Table only (no geometry).
- Cost `JobValue` (string→CAST FLOAT); work `Permit_Type` (11 vals) + `Use_Type`; **commercial discriminator** = `Permit_Type` prefix `Commercial …`/`Residential …` (clean); date `File_Date`/`Status_Date` (+`Current_Status='Issued'`). **Address redacted:** `Full_Street_Address`/`Location_1` 100% null; reconstruct from `Addr_No + Street_Name + …`. No lat/long.
- **Houston-style filter — YES (verified):** `where=Permit_Type='Commercial Building Permit' AND File_Date>=DATE '2026-01-01' AND CAST(JobValue AS FLOAT)>=500000` (2,759 commercial-2026 rows).

### Code violations / 311
- `CFW_Open_Data_Code_Violations_Table_view/FeatureServer/0` (65,718 rows). 12 types incl. **`High Grass/Weeds`, `Solid Waste Violation`, `Substandard Building`, `Property Maintenance`, `Recurring Mow Ticket`** — no graffiti/stagnant-water types (coarser than Houston). Status Open/Closed; `Violation_Address` + lat/long fully populated (GeoCodeScore 100).
- **Freshness lag:** max Case_Created_Date 2026-06-16 (~3–4 weeks behind), despite metadata `lastEditDate` 2026-07-10.

**Fort Worth verdict:** GREEN on permits (1.6M, daily, clean commercial split, filter works — but reconstruct addresses); violations geocoded/clean but coarser and ~3–4 weeks stale.

---

## Arlington
**Platform:** ArcGIS Hub (`opendata.arlingtontx.gov`, org `A7KFW0gHh8qBaXk3`). Public, no key.

### Building permits
- "Issued Permits" → `gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/1` (~18,966 rows, rolling 3-yr, **updated daily M–F**, max ISSUEDATE 2026-07-10).
- Cost `ConstructionValuationDeclared` (double); work `WORKDESC`/`SUBDESC`/`MainUse`; **commercial discriminator** = `FOLDERTYPE` (`CP`=commercial 2,719 / `RP`=residential 6,833 / `CO`/`SI`/`FE`); date `ISSUEDATE`. Address in `FOLDERNAME`; coords State-Plane ft (WKID 2276) → reproject.
- **Houston-style filter — YES (verified, 120 rows):** `where=FOLDERTYPE='CP' AND ConstructionValuationDeclared>50000 AND ISSUEDATE>TIMESTAMP '2026-04-12 00:00:00'`.

### Code violations / 311
- **UNUSABLE.** The only published "Code Compliance" datasets on Arlington's Hub are owned by `14405_greensboro` and served from `gis.greensboro-nc.gov` — they return **Greensboro, NC** rows frozen at 2024-06-18. Arlington's own disclaimer: Code Compliance moved to a new system June 2024, data no longer on the open portal. **FLAG for human:** live Arlington code data requires contacting the department.

**Arlington verdict:** Permits EXCELLENT (daily, filter expressible); 311/code UNUSABLE (mislabeled out-of-state data, live data walled).

---

## Dallas
**Platform:** Socrata (`www.dallasopendata.com`), anonymous OK.

### Building permits — effectively UNUSABLE
- Named dataset `e7gq-4sah` "Building Permits" is **frozen to calendar-2019** (max issued_date 12/31/19; metadata churn masks it). Fields exist (`value`, `permit_type`, `land_use` occupancy vocab, `issued_date` as text MM/DD/YY, address only). Filter is schema-expressible but **there is no live data to run it on** — no current public permits table found (likely behind ProjectDox/DallasNow). **FLAG.**

### Code violations / 311
- Named "Code Violations" datasets stale (best `yvha-at84` ends 2018, coarse 4-value type). **Live feed = `d7e7-envw` "311 Service Requests Oct 2020–Present"** (3.05M rows, max created_date 2026-07-11, daily, fully geocoded address + lat/long).
- **Opaque signal:** filter `department='Code Compliance'` (~740k), but ~92% collapse to a single umbrella type **`Code Concern - CCS`** (679k) — nature (weeds vs debris vs structure) is NOT a discrete field. Granular types that exist are right-of-way/infrastructure (graffiti on city property, etc.), not private-property forced maintenance. Status vocab clean.

**Dallas verdict:** Weakest of the five — 311 firehose is fresh/geocoded but the forced-maintenance nature is unresolvable from open data; permits have no live public dataset.

---

## Build-order recommendation

| Rank | City | Permits | 311 / code signal | Net |
|---|---|---|---|---|
| **1** | **San Antonio** | ✓ daily-ish, filter works | **richest** — granular Overgrown/Dumping/Graffiti/Dangerous types | Build first — both legs |
| **2** | **Austin** | ✓ **daily**, cleanest API | usable at 4 coarse buckets (granular needs per-case link) | Build first — permits ideal |
| **3** | **Fort Worth** | ✓ daily, filter works (reconstruct addr) | High Grass/Weeds etc., but coarser + ~3–4wk lag | Strong permits; violations second |
| **4** | **Arlington** | ✓ daily, filter works | **unusable** (Greensboro data / walled) | Permits-only |
| **5** | **Dallas** | ✗ no live dataset (froze 2019) | fresh firehose but ~92% opaque umbrella type | Weakest — 311 nature unresolvable |

**Cleanest first:** San Antonio (CKAN SQL, both legs, granular violations) and Austin (daily Socrata, ideal permits) are the two build-first targets. Then Fort Worth permits (repoint to ArcGIS — old Socrata ids are dead). Arlington is permits-only. Dallas is last: its permit feed is dead and its 311 collapses forced-maintenance into one opaque bucket.

**Flags for human:** free Socrata app tokens (Austin/Dallas) if production polling needs higher rate limits — sign up manually, don't self-register. Arlington live code data + Dallas live permit data are both off-portal (department contact). Nothing gated was bypassed.
