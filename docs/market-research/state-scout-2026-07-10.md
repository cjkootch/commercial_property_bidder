# State scout: which state is "Texas 2.0"? (2026-07-10)

Read-only public-endpoint recon (Task 9). Findings **unverified** — re-probe live before any move.
The stack's three signal legs are Texas agencies (TABC licenses, LGBS tax sales, CAD parcel rolls),
plus county-recorder deed freshness and a procurement footprint. Score FL / AZ / GA / NC / TN on all five;
GovOS/PublicSearch recorder tenants count double (our scraper pattern already exists).

## Scorecard

| Dimension | Florida | Arizona | Georgia | N. Carolina | Tennessee |
|---|---|---|---|---|---|
| 1. Alcohol licensing (pending apps + address) | **Strong** | **Strong** | Partial | Partial–Weak | Partial |
| 2. Tax sales (public property lists) | **Strong** | **Strong** | **Strong** | Weak–Partial | **Strong** |
| 3. Parcel rolls (owner/class/value/deed) | **Strong** | **Strong** | **Strong** | **Strong** | **Strong** |
| 4. Recorder freshness (metros; GovOS=2×) | **Strong** | Partial | **Strong** | Partial | Weak |
| 5. Procurement (Bonfire/Ionwave/CivicEngage) | **Strong** | Partial–Weak | Partial | **Strong** | Weak |
| **Overall** | **A (5/5)** | A− | B+ | B | B |

**Recommended state: FLORIDA. First metro: Tampa / Hillsborough County.**

---

## Florida — A (top-tier Texas 2.0)
1. **Licensing — Strong.** DBPR AB&T publishes **machine-readable CSV extracts updated every morning**, including a New/Owner-Change application extract with Application Number + Application Type + Approval Date and full premises street address — a genuine pending/new-app feed (matches or beats TABC). Live sample: `https://www2.myfloridalicense.com/abt/eds/BusinessEntities-A.csv` → `20,4101321,400,4012,RTPD,DISNEYS VERO BEACH RESORT,9250 ISLAND GROVE TERR,,VERO BEACH,32963,FL,41`. (FLAG: human-readable case-disposition PDFs are stale; the daily EDS CSVs are current.)
2. **Tax sales — Strong.** County tax-DEED auctions (FS Ch.197) uniformly on RealAuction (`*.realtaxdeed.com`) + "Lands Available" lists. Hillsborough `https://hillsborough.realtaxdeed.com/`, Duval `duval.realtaxdeed.com`, Orange, Lee, Marion, St. Lucie, Pasco, Brevard — one scraper generalizes.
3. **Parcels — Strong.** Single statewide FeatureServer (FGIO/FDOR) covering all 67 counties w/ owner+value+sale+use-code: `https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0` (fields OWN_NAME, JV, DOR_UC, SALE_PRC1/SALE_YR1). Verified Alachua sample: `PARCEL_ID 03007000000, OWN_NAME "WADSWORTH, BRENT C ETAL", JV 24000`.
4. **Recorder — Strong.** All 4 major metros expose free official-records search; **two on double-count vendors**: Broward AcclaimWeb (GovOS/Granicus family) `https://officialrecords.broward.org/AcclaimWeb`, Orange Tyler EagleRecorder `https://or.occompt.com/recorder/web/`. Miami-Dade + Hillsborough clerk-hosted. (FLAG: certified-through dates are JS-rendered — need an in-app probe, no login.)
5. **Procurement — Strong.** Hillsborough County on **Bonfire** (`https://hillsboroughcounty.bonfirehub.com/portal/`), Tampa DemandStar, Orange ProcureNow/OpenGov (all Euna). Miami-Dade outlier (Oracle).

**Bottom line:** five-for-five; the DBPR daily application CSV is the standout. **First metro Tampa/Hillsborough** hits every leg with least friction (RealAuction tax deeds + Lands Available, self-host Esri parcels joinable to statewide FDOR layer, live Bonfire tenant, daily DBPR CSV, clerk records search). Broward is runner-up on the strength of its GovOS/Acclaim double-count recorder.

## Arizona — A−
- **Licensing Strong:** DLLC exposes pending applications directly — `https://www.azliquor.gov/query/results_pendingapps.cfm?sortby=County` (statewide, single source; bot got 403 → FLAG human to confirm address column/export).
- **Tax sales Strong:** Maricopa Treasurer downloadable State CP tax-lien CSV/PDF (`treasurer.maricopa.gov/TaxAssignment/statecpdata`) + Pima online lien sale.
- **Parcels Strong (best sampled):** Maricopa Assessor open ArcGIS REST, no token — `https://gis.mcassessor.maricopa.gov/arcgis/rest/services/MaricopaDynamicQueryService/MapServer/3` (OWNER_NAME, PHYSICAL_ADDRESS, FCV_CUR, DEED_DATE, SALE_PRICE). Verified live rows.
- **Recorder Partial:** Maricopa Recorder free first-party search, daily, 1871–present, but 2-yr full-text window, no certified-through banner, **not** a GovOS tenant (no double-count).
- **Procurement Partial–Weak:** Phoenix on OpenGov, Tucson/Mesa in-house; Bonfire only at second-tier (MCCCD, Pinal). Fragmented.
- **First metro Phoenix/Maricopa** — best open assessor API of any county sampled; drag is procurement.

## Georgia — B+
- **Licensing Partial:** state DOR publishes monthly **Active Alcohol Licenses** XLSX with premises addresses (`https://dor.georgia.gov/active-alcohol-licenses`) but it's *active*, state-issued types only; high-signal retail on-premise licensing is **local** (Atlanta PD, counties) → fragmentation, no statewide pending-app feed.
- **Tax sales Strong:** county first-Tuesday levy lists, fresh (DeKalb grid row dated 02-JUN-2026), Fulton/Gwinnett/Cobb.
- **Parcels Strong:** qpublic/Schneider (Beacon) across most counties; Gwinnett footer "Last Data Upload 7/11/2026" (today).
- **Recorder Strong (beats TX):** statewide **GSCCCA** deed index + PT-61 transfer index (`https://search.gsccca.org/RealEstate/namesearch.asp`). FLAG: deep document view needs free registration — don't bypass.
- **Procurement Partial:** state GPR aggregator + mixed local (Savannah CivicEngage confirmed); no dominant vendor.
- **First metro Atlanta / Fulton–DeKalb.** Georgia beats Texas on statewide recorder + statewide active-license roll but loses on retail-license application fragmentation.

## North Carolina — B
- **Licensing Partial–Weak:** control state; NC ABC permittee search + downloadable Permit Counts (`https://abc2.nc.gov/Search/Permit`), addresses exposed, but no clear public dated pending-application feed (apps behind `aps.abc.nc.gov` email wall → FLAG).
- **Tax sales Weak–Partial:** mortgage-style/in-rem foreclosures run by private firms (Kania, RBCWB) — lists fragmented, firm-hosted, not centralized/machine-readable.
- **Parcels Strong:** Wake ArcGIS REST verified (`https://maps.wakegov.com/arcgis/rest/services/Property/Parcels/MapServer/0` — OWNER, TOTSALPRICE, TOTAL_VALUE_ASSD, deed/plat ref); Mecklenburg POLARIS + Hub; NC OneMap statewide.
- **Recorder Partial:** all 3 metros have public grantor/grantee search (Mecklenburg Manatron, Wake BooksWeb [503 on probe], Guilford RDLxWeb) — but legacy/in-house, **no GovOS double-count**, certified-through not confirmable from landing pages.
- **Procurement Strong:** Charlotte + Wake on **Bonfire**, statewide NC eVP.
- **First metro Mecklenburg/Charlotte** (Wake close 2nd). Solid property-intelligence state, but the two leading-indicator legs (alcohol apps, tax sales) are structurally muted.

## Tennessee — B
- **Licensing Partial:** TABC statewide license/permit search with addresses (`https://rlpsmobile.abc.tn.gov/LicenseSearch/...`) but issued-not-pending, no bulk export; applications behind Accela login; **beer licensed by local boards** (fragmented).
- **Tax sales Strong:** Nashville Chancery C&M public delinquent lists; Shelby online via ZeusAuction + Trustee "Properties Available."
- **Parcels Strong (best-in-class statewide):** Comptroller **TPAD** covers ~86/95 counties + monthly county shapefile downloads + statewide feature service (`https://assessment.cot.tn.gov/tpad/`).
- **Recorder Weak:** Davidson RoD online is **subscription-only** ($50/mo); Shelby free but "verified through Nov 2023" (badly stale); Knox subscription-oriented. No GovOS tenant.
- **Procurement Weak:** Nashville Oracle iSupplier, Knoxville in-house; no target-stack footprint.
- **First metro Nashville/Davidson** — great parcels + tax sales, but recorder is the known gap (budget the Metro sub or pivot recorder signals to Shelby).

---

## Recommendation

**Go Florida; open in Tampa / Hillsborough County.** It's the only 5/5: a daily DBPR application CSV that matches TABC's leading-indicator value, a uniform RealAuction tax-deed pattern that clones the LGBS pipeline, a one-query statewide parcel FeatureServer, metro recorder search (two on our double-count GovOS/Acclaim + Tyler patterns), and a live Bonfire procurement tenant. **Arizona (Phoenix) is the runner-up** and actually has the single best open assessor API sampled — reconsider it if procurement coverage matters less than parcel depth. Georgia is the wildcard: it *beats* Texas on statewide recorder + license roll but its retail-license applications are locally fragmented.

**Human-action flags:** FL recorder certified-through needs an in-app probe (no login); AZ DLLC-pending + Maricopa CP CSV returned 403 to the bot (confirm fields manually); GA GSCCCA deep view + NC `aps.abc.nc.gov` + TN Accela/Nashville-RoD are registration/subscription-gated — flagged, not bypassed.
