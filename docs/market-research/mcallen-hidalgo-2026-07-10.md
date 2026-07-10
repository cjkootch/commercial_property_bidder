# McAllen–Hidalgo Full Market Workup — 2026-07-10

**Scope:** Read-only research on PUBLIC endpoints only. No logins, payments, registrations, form
submissions, or CAPTCHA/Turnstile bypass. No writes to the Greenkeep repo/DB/credentialed systems.
All findings below are UNVERIFIED probes — exact URLs, the producing query, and sample rows are
shown so a human can re-check. Parcel vintage/tax-year is stated wherever measurable.

Source script: `scripts/probe-market.ts` on `main`
(`npm run probe:market -- --name "McAllen" --counties "HIDALGO" --cities "McAllen,Edinburg,Mission,Pharr" --slugs ...`),
supplemented with hand AGOL catalog queries, live REST re-probes, and portal-platform discovery.

Candidate metro #10 in the Texas expansion sweep. Prior sweep entry:
`texas-metro-sweep-2026-07-10.md` §1 (McAllen–Hidalgo = "honorable mention / #9").

---

## 1. Hidalgo CAD parcels — AGOL county-scale hunt

**Verdict: NO working county-scale (>100k), fully-attributed, public AGOL parcel FeatureServer/MapServer
exists today.** The prior sweep's only county-scale option (`gismap.mcallen.net/.../ParcelEditing/MapServer/13`)
is now **DEAD (404)**. The best *reachable* county-scale layer (RGV911, 334k rows, fresh 2026 load) is
**attribute-incomplete** (owner + geometry + land value only — no market value, no PTAD class, no deed date,
no acreage). Full-schema public AGOL layers exist only as **per-city clips** (Edinburg ~60k, Weslaco ~30k,
Palmview). This is the classic "reachable-but-WRONG/partial" trap — evidence below.

### Catalog queries run
`GET https://www.arcgis.com/sharing/rest/search?q=<term>&num=15&f=json` with terms:
`Hidalgo county parcels texas` (probe default), `Hidalgo parcels`, `Hidalgo CAD`, `HCAD parcels`,
`Hidalgo appraisal district`, `Rio Grande Valley parcels`, `HCAD parcels marketValue`,
`EDINBURG parcels`, `Weslaco HCAD`, plus vendor terms (`Maplink`, `GenCode`, `bis consultants`,
`trueautomation`, `PACS`) — vendor terms returned nothing Hidalgo-specific.

### Candidate layers — live re-probe results

| Layer (owner) | URL | Rows | Owner | PTAD class | Mkt value | Acres | Deed | Vintage | Public? |
|---|---|---|---|---|---|---|---|---|---|
| **RGV911 "Hidalgo Parcels"** (ESRI_RGVTEAM) | `gis.rgv911.org/server/rest/services/RGV911_Web_Apps_MIL1/MapServer/7` | **334,585** | ✓ `file_as_name` | ✗ null | ✗ null | ✗ null | ✗ null | **fresh (created/edited 2026-06-10)** | ✓ yes (self-hosted AGS, not AGOL) |
| RGV911 "H_PARCELS" (dup) | `.../Public_Map_MIL1/MapServer/13` | 334,585 | ✓ | ✗ null | ✗ null | ✗ null | ✗ null | same load | ✓ yes |
| **Edinburg "EDINBURG HCAD PARCELS"** (CityofEdinburg) | `services7.arcgis.com/z3I4HxFCWafiHSiG/arcgis/rest/services/COE_HCAD/FeatureServer/0` | 60,545 | ✓ `name` | ✓ `stateCd` | ✓ `marketValue` | ✓ `landTotalAcres` | ✓ `deedDt` | **2025-09-22 roll** (title `..._250922`) | ✓ **AGOL, full schema** |
| Weslaco "WESLACO HCAD PARCELS" (cowgis19) | `services7.arcgis.com/9yzEIJbAp0HzkDjg/arcgis/rest/services/COW_HCAD/FeatureServer/0` | 29,917 | ✓ | ✓ | ✓ | ✓ | ✓ | (same COx_HCAD family) | ✓ AGOL, full schema |
| Palmview "HCAD Palmview Parcels Official" (palmviewtx) | `services5.arcgis.com/pp0wkqkFnyISMkfp/arcgis/rest/services/HCAD_Palmview_Parcels_Official/FeatureServer` | small (1 city) | ✓ | — | — | — | — | 07/2024–01/2025 tiles | ✓ AGOL |
| **CAD own server** "Parcels - TX - Hidalgo County" (GDITAdmin) | `propaccess.hidalgoad.org/arcgis/rest/services/HidalgoMapSearch/MapServer/0` | — | — | — | — | — | — | — | ✗ **DNS does not resolve** (`Could not resolve host`) — dead/internal |
| "HC_Parcel" (gisjefe) | `services3.arcgis.com/NIAfqIRrUGOfwOtZ/arcgis/rest/services/HC_Parcel/FeatureServer` | — | — | — | — | — | — | — | ✗ **token-required** (`code 499 Token Required`) — private |
| Pharr "Pharr Published" (jose.chavez_COP) | `services.arcgis.com/Uj8MycSVzMEzm7ey/arcgis/rest/services/Pharr_Published/FeatureServer/1` | 38,838 | ✗ (CAD lot-lines only: OBJECTID + edit stamps) | ✗ | ✗ | ✗ | ✗ | — | ✓ but geometry-only, no attributes |
| Edinburg "COE_PROPERTIES" | `services7.arcgis.com/z3I4HxFCWafiHSiG/arcgis/rest/services/COE_PROPERTIES/FeatureServer` | small | city-owned parcels only | — | — | — | — | 2023 | ✓ (not a roll) |

### Evidence — the RGV911 334k layer is owner+geometry only (partial attribute join)

Field-population counts (`/query?where=<field> IS NOT NULL&returnCountOnly=true&f=json`):
```
file_as_name IS NOT NULL -> 334,585   (owner: populated)
land_val     IS NOT NULL -> 334,585   (land value: populated)
legal_desc   IS NOT NULL -> 334,585   (populated; embeds acreage as text, e.g. "1.26AC GR 1.07AC NET")
market       IS NOT NULL -> 0         (market value: EMPTY)
assessed_val IS NOT NULL -> 0         (EMPTY)
state_cd     IS NOT NULL -> 0         (PTAD class: EMPTY)
land_acres   IS NOT NULL -> 0         (EMPTY)
imp_val      IS NOT NULL -> 0         (EMPTY)
deed_dt      IS NOT NULL -> 0         (deed date: EMPTY)
```
Sample row (`/query?where=land_val>1000&outFields=prop_id,file_as_name,land_val,state_cd,market,situs`):
```
{prop_id:112354, file_as_name:'GANDY HATTIE', land_val:48920, state_cd:null, market:null,
 situs:'1130 N ALAMO RD, TX', legal_desc:"ALAMO LAND & SUGAR CO ... 1.26AC GR 1.07AC NET"}
```
Vintage is **fresh**: `min/max(created_date)=min/max(last_edited_date)=2026-06-10` (one bulk load,
~1 month old). So it is current geometry with a *current owner list*, but the value/class/deed
columns advertised in its schema were never populated in this publish. Usable as an owner+geometry
base; **not** usable for market value / PTAD class / acreage / deed turnover without a second source.
The schema is a verbatim PACS/TrueProp export (`file_as_name`, `state_cd`, `deed_dt`, `market`,
`assessed_val`, `land_acres`, `yr_blt`, `geo_id`) — the join simply wasn't run.

### Evidence — Edinburg COE_HCAD is fully populated (but city-clipped, 60k not 330k)

Population + sample (`/0/query?...`):
```
marketValue NOT NULL -> 59,860 ;  stateCd NOT NULL -> 60,544 ;  deedDt NOT NULL -> 59,860 ;
landTotalAcres NOT NULL -> 59,860 ;  appraisedValue NOT NULL -> 59,860
Sample: {PROP_ID:296016, name:'RAYGOZA FAMILY REVOCABLE LIVING TRUST', stateCd:'E1',
         marketValue:460134, appraisedValue:133601, landTotalAcres:19.24,
         deedDt:'2025-05-02 ', imprvActualYearBuilt:2017}
        {PROP_ID:296017, name:'WEFLIP LLC', stateCd:'B1', marketValue:604184,
         landTotalAcres:0.7, deedDt:'2024-02-29 '}
```
Vintage: **2025-09-22** (service name `EDINBURG_HCAD_PARCELS_250922`). Deed freshness:
`deedDt > '2026-01-10'` -> **4,116** rows (real recent turnover signal). Normalizer quirks:
`deedDt` is a **String** `YYYY-MM-DD` with a **trailing space** and `'NULL'` / blank sentinels
(`orderByFields=deedDt DESC` surfaces literal `'NULL'` strings first — filter them).
`stateCd` = real PTAD codes (E1 rural-improved, B1 multifamily, etc.).

### Evidence — the prior county-scale host is now dead

`gismap.mcallen.net` resolves and the IIS server answers, but every ArcGIS REST path 404s:
```
GET https://gismap.mcallen.net/arcgis/rest/services?f=json                        -> 404
GET https://gismap.mcallen.net/arcgis/rest/services/ParcelEditing/MapServer/13/query -> 404 (prior sweep's layer)
GET https://gismap.mcallen.net/server/rest/services?f=json                        -> 404
```
The 2020-frozen `ParcelEditing/MapServer/13` cited in the prior sweep is gone. Do **not** carry it.

### Recommendation for the parcel build
- **Commercial-property sourcing (the primary use case):** the cleanest full-schema public option is the
  **city-clip AGOL layers stitched together** — Edinburg `COE_HCAD` (60.5k, owner/class/value/acres/deed,
  2025 roll) + Weslaco `COW_HCAD` (30k) + Palmview, all AGOL-hosted (no Vercel-egress risk). Downside:
  they cover only their cities/ETJs, leaving McAllen, Mission, Pharr, Edinburg-outskirts uncovered — i.e.
  **not** a full-county footprint. Each is a near-copy schema, so one normalizer covers all three.
- **County-wide footprint:** only RGV911 (334k) gives full county coverage and is fresh, but ships
  owner+geometry+land_val only. Viable as a geometry/owner spine to be **joined** to a value/class source.
- **FLAG (human decision):** to get a true current, full-schema, county-wide Hidalgo roll, the path is a
  **CAD data request to Hidalgo CAD** (`hidalgoad.org`) or a paid vendor extract — the public AGOL catalog
  does not expose one. Confirm whether Vercel egress can reach `gis.rgv911.org` (self-hosted ArcGIS Server,
  not `services*.arcgis.com`) before relying on the 334k layer.

---

## 2. TABC pending applications — Hidalgo County

Probe output (`data.texas.gov/resource/mxm5-tdpj.json`, `$where upper(county) in ('HIDALGO')`):

> **HIDALGO: 23 pending — GO**

Highest TABC pending count in the entire 8-metro sweep (ties for the top forced-demand signal).
The probe queries at county grain only; the four target cities (McAllen, Edinburg, Mission, Pharr)
are the county's population centers and will hold the bulk of those 23 — the per-city split is a
human follow-up on the same dataset (add `city` to `$select`/`$group`). Prior sweep also logged 23.

LGBS tax-sale pipeline (same run): **HIDALGO: 53 in pipeline — GO**.

---

## 3. Procurement portals

**Bonfire (probe slug-fuzz + `/portal` title verify):** only two agencies answer, both **0 open now**:
- `lajoyaisd.bonfirehub.com` — "La Joya ISD" (0 open)
- `utrgv.bonfirehub.com` — "University of Texas Rio Grande Valley" (0 open)

No city (McAllen/Edinburg/Mission/Pharr), county, STC, or other-ISD slug answered Bonfire. So a
`bonfirePortals` registry entry for this market would effectively no-op — same as Waco/Beaumont.

**Dominant platform here is ProcureWare + OpenGov, not Bonfire/Ionwave.** Portal map (title-verified):

| Agency | Platform | Public no-login listing? | Endpoint / evidence |
|---|---|---|---|
| **City of McAllen** | ProcureWare | Viewable in-browser, **JS shell** (not raw-HTTP scrapeable; `/api/*` 403) | `mcallen.procureware.com/Bids` |
| **City of Mission** | ProcureWare | same (JS shell) | `cityofmission.procureware.com/Bids` |
| **City of Pharr** | ProcureWare | same (JS shell); city page "View Open Bids" → `pharr.procureware.com/login` | `pharr.procureware.com` |
| **Hidalgo County** | **CivicEngage bid board** | **YES — server-rendered, no login** ✓ | `hidalgocounty.us/Bids.aspx?CatID=All&showAllBids=on` |
| Hidalgo County (alt) | OpenGov e-procurement | **No** — Cloudflare "Just a moment" challenge (gated) → FLAG | `procurement.opengov.com/portal/co-hidalgo-tx` |
| **City of Edinburg** | OpenGov e-procurement | **No** — OpenGov (Cloudflare-gated, reg to subscribe) → FLAG | `cityofedinburg.com/departments/finance/purchasing.php` |
| **South Texas College** | OpenGov (migrated from PublicPurchase) | PublicPurchase public home reachable; OpenGov gated → FLAG | `publicpurchase.com/gems/southtexascollege,tx/buyer/public/home` |
| City of Mission (alt) | CivicPlus bid board | likely public (CivicPlus) — verify | `missiontexas.us/257/Bid-Opportunities` |
| Edinburg CISD | DemandStar | reg-gated (free) → FLAG | `demandstar.com/app/agencies/texas/edinburg-cisd-purchasing/...` |
| Mission CISD | DemandStar | reg-gated (free) → FLAG | `demandstar.com/app/agencies/texas/mission-consolidated-indpndnt-schl-dist/...` |
| STC (alt) | DemandStar | reg-gated (free) → FLAG | `demandstar.com/app/agencies/texas/south-texas-college/...` |
| McAllen ISD, Sharyland ISD | Ionwave (behind Cloudflare) | **FLAG — Cloudflare challenge** (`429` + "Just a moment...") — did NOT bypass | `mcallenisd.ionwave.net`, `sharylandisd.ionwave.net` |

### Best public, no-login, raw-HTTP-scrapeable feed
**Hidalgo County CivicEngage bid board** — `hidalgocounty.us/Bids.aspx?CatID=All&txtSort=Category&showAllBids=on`
returns server-rendered HTML with real open bids. Sample titles pulled from raw HTML (`Bids.aspx?bidID=NN`):
"Online Pharmacy Billing Services", "Independent Audit Services", "Actuarial Consulting Services for
PART I-GASB 43/45 OPEB Valuation", "Workers' Compensation Loss and Funding Projections Actuarial Study",
"Actuarial Services for GASB 74 and 75". One CivicPlus/CivicEngage parser (`Bids.aspx?bidID=` +
category/close-date cells) generalizes to any CivicEngage `.us` agency.

### FLAGs (human action — gated, not bypassed)
1. **OpenGov portals** (Hidalgo County, Edinburg, STC) sit behind **Cloudflare Turnstile/"Just a moment"** —
   no rows scrapeable without an attended browser or free vendor account. Recommend a human decision on an
   attended path or a free OpenGov vendor account.
2. **ProcureWare** (McAllen, Mission, Pharr) `/Bids` is a JS/Angular app (`/api/*` returns 403) — bids
   render client-side only. Needs a headless browser to read, or a ProcureWare public-API path a human can
   confirm. Not a plain-GET feed.
3. **Ionwave** (`mcallenisd`, `sharylandisd`) subdomains **exist but are Cloudflare-challenged** (429 +
   "Just a moment...") — unlike the plain-HTML Ionwave agencies found in the San Antonio/El Paso sweep.
   Did not bypass. FLAG for attended verification.
4. **DemandStar** (Edinburg CISD, Mission CISD, STC) — free registration to view. FLAG.

---

## 4. MSA / bbox sanity

Existing neighbor bboxes (`lib/markets.ts`): Brownsville–Harlingen (Cameron Co.)
`[-97.87, 25.83, -97.15, 26.53]`; Corpus `[-97.9, 27.4, -96.9, 28.2]`; Laredo `[-99.1, 28.8, -97.9, 29.72]`.

Hidalgo County sits **west of Cameron**. The Cameron/Hidalgo county line runs ≈ longitude **-97.86 to -97.87**,
which is exactly Brownsville's west edge (`-97.87`). Setting Hidalgo's **east edge = -97.87** cleanly cedes
Harlingen (Cameron) to the Brownsville market — a shared edge, identical to how Beaumont's west edge shares
`-94.4` with Houston's east edge. Hidalgo's live parcel extent (RGV911 layer 7, reprojected from Web
Mercator) is lon **-98.59 → -97.86**, lat **26.02 → 26.78**, confirming the footprint.

**Proposed Hidalgo bbox `[west, south, east, north]`:**
```
[-98.6, 25.95, -97.87, 26.78]
```
Overlap check (repo test uses strict `<`, so shared edges are allowed):
```
vs Brownsville [-97.87,25.83,-97.15,26.53]  -> NO overlap (shared east edge -97.87 == its west edge)
vs Corpus      [-97.9, 27.4, -96.9, 28.2 ]  -> NO overlap (Hidalgo north 26.78 < Corpus south 27.4)
vs Laredo      [-99.1, 28.8, -97.9, 29.72]  -> NO overlap
```
South edge 25.95 gives a small cushion below the county line into the Rio Grande; north 26.78 covers
Edinburg/north-county. This is registry-ready.

---

## Consolidated human-action flags
1. **True full-county Hidalgo roll** → CAD data request to Hidalgo CAD (`hidalgoad.org`) or paid vendor; the
   public AGOL catalog has no county-scale full-schema layer. (`propaccess.hidalgoad.org` DNS-dead;
   `HC_Parcel` token-required; `gismap.mcallen.net` REST now 404.)
2. **Vercel egress reachability** to `gis.rgv911.org` (self-hosted ArcGIS Server) before relying on the
   334k owner/geometry layer.
3. **OpenGov Cloudflare gate** (Hidalgo County / Edinburg / STC) — attended browser or free vendor account.
4. **ProcureWare JS shell** (McAllen / Mission / Pharr) — headless browser or confirmed public API path.
5. **Ionwave Cloudflare gate** (McAllen ISD, Sharyland ISD) — attended verification.
6. **DemandStar free registration** (Edinburg CISD, Mission CISD, STC) to view bids.
