# Texas Metro Expansion Sweep — 2026-07-10

Read-only public-endpoint probe. No writes to the Greenkeep repo/DB/credentialed systems.
Source script: `scripts/probe-market.ts` on `main` (LGBS + TABC + Bonfire + AGOL parcel discovery),
supplemented per-metro with CAD-site parcel discovery and agency-specific Bonfire slugs.

---

## 1. Metro readiness — 8 candidates

| Metro (counties) | LGBS tax sales | TABC pending | Bonfire (open now) | Parcel layer | Host |
|---|---|---|---|---|---|
| **Brownsville–Cameron** | **85 GO** | 12 GO | City of Brownsville (9 open); TSC, UTRGV (0) | CCAD_Parcels 185,233 — owner/class/value/acres/deed | **AGOL ✓** services2 |
| **Beaumont–Jefferson** | **215 GO** | 11 GO | none | JCAD_Parcels 51,172 — owner/class/value/acres | **AGOL ✓** services7 |
| **McAllen–Hidalgo** | 53 GO | **23 GO** | La Joya ISD, UTRGV (0 open) | HCAD Parcels 265,829 — owner/class/value/acres | ⚠ non-AGOL (gismap.mcallen.net) |
| **Waco–McLennan** | 31 GO | 9 GO | none | McLennanCAD (AGOL) OR Waco 143,197 (richer, real Date deeds) | AGOL fallback ✓ / ⚠ county-hosted |
| **Lubbock** | 0 (not carried) | 20 GO | South Plains College, Lubbock County (0) | City "Parcel" 108,320 — owner/class/value | ⚠ non-AGOL (pubgis.ci.lubbock.tx.us) |
| **Killeen-Temple–Bell** | 0 (not carried) | 6 GO | City of Temple (12 open) | BellCADWebService 169,398 — owner/value/acres, NO class | **AGOL ✓** services7 |
| **Amarillo–Potter/Randall** | 0/0 (not carried) | Potter 5 GO, Randall 0 | City of Amarillo (2 open) | PRAD 118,989 — owner/value, NO class/acres/deed | ⚠ non-AGOL (gismaps.amarillo.gov) |
| **Laredo–Webb** | 0 (not carried) | 4 GO | Laredo ISD (1 open) | none county-scale public; CAD auth-gated | ⚠ auth-walled |

### Per-metro parcel/deed quirks (normalizer notes)
- **Brownsville–Cameron:** `CCAD_Parcels_View` at `services2.arcgis.com/6oaLMZEZlktbQpyi`. `deedDt`/`deedRecDt` are **String** `YYYY-MM-DD` with a single-space `' '` null sentinel; filter out zeroed placeholder rows (owner `"Undefined: PENDING RESEARCH"`). Best schema completeness of the set.
- **Beaumont–Jefferson:** `JCAD_Parcels` at `services7.arcgis.com/u4uzNuvx1pUPXeg8`. `DATE_ACQ` is Integer `201810` (TNRIS vintage stamp, not a deed date); whole layer is a **2018 snapshot** — stale, no residential-turnover signal, but geometry/owner/class/value fine for commercial sourcing. Not in the AGOL catalog search — found by title.
- **McAllen–Hidalgo:** `gismap.mcallen.net/.../ParcelEditing/MapServer/13` (265,829). Values frozen to **2020** (`F2020_*`); no deed field (only GIS edit stamps); truncated 10-char field names. Non-AGOL municipal host — verify Vercel egress reachability.
- **Waco–McLennan:** AGOL `McLennanCADWebService` (`services8`, bis vendor — same family as Hays/El Paso, near copy-paste) has String `Deed_Date`, no class. County-hosted `gis.wacotx.gov` is richer (+27k rows, `state_cd`, real **Date** deed fields) but non-AGOL — use as upgrade after reachability check.
- **Lubbock:** usable layer is city-hosted `pubgis.ci.lubbock.tx.us/.../ParcelViewer/MapServer/5`; class = `SPTB_CODE` (won't match probe regex), no deed date, no acres (derive from `SQUARE_FOOT`). AGOL "Lubbock" hits were an Alaska false positive.
- **Killeen-Temple–Bell:** `BellCADWebService` (`services7`, bis vendor) AGOL — clean host. `Deed_Date` is **String** `MM/DD/YYYY`; **no PTAD class field**. No separate county REST (BIS front-end only).
- **Amarillo:** `gismaps.amarillo.gov/.../PRADParcels/MapServer/0`. No class, no acres, no real deed date (`EDIT_DATE` bulk-stamped); values are strings; `PARCEL_COUNTY` uses cryptic codes, not county names — per-county split needs `COUNTY` field or spatial join. Non-AGOL.
- **Laredo–Webb:** weakest. No county-scale public parcel service; `gis.webbcad.org` redirects to `/auth/login` (auth required — flag). Only public option is a 3,896-parcel border clip. Parcel buildout needs a CAD data request or paid vendor.

### Ranked recommendation — build #7 and #8

**#7 → Brownsville–Cameron.** The cleanest all-green in the sweep: LGBS 85, TABC 12, a live Bonfire portal with 9 open right now, **and** an AGOL-hosted parcel layer (no reachability risk) carrying the richest schema — owner, state-class, value, acres, and an actual deed field. Lowest build friction, highest signal. The only work is a straightforward normalizer for the String deed dates + the `' '` sentinel and placeholder-row filtering.

**#8 → Beaumont–Jefferson.** Highest forced-demand signal in the entire sweep — **LGBS 215** tax-sale pipeline (2.5× the next metro) plus TABC 11 — on an **AGOL-hosted** parcel layer (copy-paste adapter, no reachability risk). Two caveats to accept knowingly: no Bonfire portal (RFP coverage comes from the alternate-portal track — likely Ionwave/DemandStar; needs a slug/platform hunt), and the parcel layer is a 2018 snapshot with no deed date (fine for commercial-property sourcing; provides no residential-turnover signal). The tax-sale volume makes it worth building despite those.

**Honorable mention / #9:** McAllen–Hidalgo — biggest market (265k parcels) and highest TABC (23), but gated behind a non-AGOL municipal host with 2020-frozen values. Worth it once Vercel-egress reachability to `gismap.mcallen.net` is verified. Waco is the sleeper if real Date deed data matters (its county-hosted layer is the only one with native-Date deeds), with a bis-vendor AGOL fallback for the copy-paste adapter.

---

## 2. Alternate procurement portals (6 live metros)

Biggest cross-cutting win of the sweep. **Ionwave** exposes fully public, no-login, server-rendered HTML bid tables — and one parser covers every `*.ionwave.net` agency statewide.

| Agency | Platform | Public no-login listing? | Endpoint |
|---|---|---|---|
| SAWS (San Antonio Water) | **Ionwave** ✓ | Yes (15 live) | `sawsbid.ionwave.net/SourcingEvents.aspx?SourceType=1` |
| City of El Paso | **Ionwave** ✓ | Yes (7 live) | `elpasotexas.ionwave.net/SourcingEvents.aspx?SourceType=1` |
| El Paso County | **Ionwave** ✓ | Yes (6 live) | `epcountypurchasing.ionwave.net/SourcingEvents.aspx?SourceType=1` |
| City of San Antonio | In-house bid board ✓ | Yes | `webapp1.sanantonio.gov/BidContractOpps/Default.aspx` |
| City of Austin | eResponse (ColdFusion) ✓ | Yes | `financeonline.austintexas.gov/afo/.../solicitations.cfm` |
| CapMetro | PlanetBids | View free, JS-rendered | `vendors.planetbids.com/portal/39494/bo/bo-search` |
| CCRTA | PlanetBids | View free, JS-rendered | via `ccrta.org/vendors` |
| Bexar County | BidNet Direct | **No** — free reg to see details | `bidnetdirect.com/texas/bexar-county` |
| City of Corpus Christi | Infor CloudSuite | **No** — free reg | `sms-corpuschristi-prd.inforcloudsuite.com` |
| Port of Corpus Christi | ProcureWare | **No** — JS/login-gated | `pocca.procureware.com/Bids` |

Ionwave table shape (identical across agencies → one reusable parser): `Bid Number | Bid Title | Bid Type | Organization | Issue Date | Close Date/Time`. `SourceType=1/2/3` = Current/Closed/Awarded. **No DemandStar or Periscope/BuySpeed found in use at any of the six.**

**Coverage impact:** 5 immediately-scrapeable public feeds across San Antonio, El Paso, and Austin with plain HTTP GET + HTML parsing; the Ionwave parser generalizes to dozens more TX agencies at ~zero marginal cost.

---

## 3. Fresh deed sources — Bexar & El Paso

- **Bexar — USABLE NOW.** Bexar County Clerk Official Records (GovOS/Kofile PublicSearch), `bexar.tx.publicsearch.us`. Recorded-date-range query `?department=RP&recordedDateRange=YYYYMMDD,YYYYMMDD`. Fields: grantor, grantee, docType, **recordedDate** (real date), instrumentDate, docNumber, book/vol/page, legal, property address, consideration. **Certified through 07/07/2026** (3 days fresh); a 07/01–07/10 query returned 4,761 records. Public, no login (reCAPTCHA only gates cart, not search). Drive via headless browser (backend API host not reachable from our infra). ⚠ Confirm export/reCAPTCHA limits before bulk scraping.
- **El Paso — BLOCKED.** County Clerk search (`apps.epcountytx.gov/publicrecords`) has the right fields (Style doc-type dropdown, `InstrumentDateFrom/To`) but is behind a **Cloudflare Turnstile** challenge — no sample rows obtainable, not bypassed. All other El Paso sources (QuickLink historic, GIS quarterly, EPCAD) are stale. **Flag for human:** approve an attended/real-browser Turnstile path, or El Paso stays blocked.

Full detail: `greenkeep/fresh-deed-sources-bexar-elpaso.md`.

---

## 4. Login-gated Bonfire re-probe — San Antonio & Bexar

Both portals resolve and are genuine: `sanantonio.bonfirehub.com` ("City of San Antonio, TX"), `bexar.bonfirehub.com` ("Bexar County"). The public `/portal` HTML is an **empty React/Underscore app shell** — tables are un-rendered JS templates (`Status | Ref.# | Project | Close Date | Days Left`), so **zero opportunity data is scrapeable from raw HTML**. Guessed API paths 404. The `getOpenPublicOpportunitiesSectionData` JSON needs an authenticated session.

**Flag for human:** free vendor registration on the Euna Supplier Network (`vendor.bonfirehub.com/sign-up`, no card, no fee) would unlock the JSON for both portals. Recommend you create one free account manually; I did not register.

---

## Human-action flags (consolidated)

1. **Free Euna/Bonfire vendor account** (`vendor.bonfirehub.com/sign-up`) — unlocks SA + Bexar Bonfire JSON. No cost.
2. **Bexar BidNet Direct, Corpus Infor, Port of CC ProcureWare** — free registration to view bids.
3. **El Paso County Clerk deed search** — Cloudflare Turnstile; needs a human decision on an attended browser path.
4. **Bexar GovOS deed export** — confirm export volume / reCAPTCHA limits before scaling a bulk pull.
5. **Webb CAD GIS** — auth-walled; parcel data needs a direct CAD data request or paid vendor.
6. Non-AGOL parcel hosts to verify for Vercel egress before wiring: McAllen (`gismap.mcallen.net`), Waco (`gis.wacotx.gov`), Lubbock (`pubgis.ci.lubbock.tx.us`), Amarillo (`gismaps.amarillo.gov`).
