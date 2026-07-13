# Residential deed-source map — what's actually usable (2026-07-13)

Verdict up front: **fresh, structured recently-sold single-family data at the
HCAD/TAD quality bar is NOT available via public ArcGIS for any market beyond
Houston (Harris) and Fort Worth (Tarrant).** Every alternative probed live is
stale, string-corrupted, permission-gated, query-disabled, or too slow for a
county-wide scan. "Build residential for all markets" therefore needs a
different data strategy, not another adapter in the current pattern.

## What the current feeds rely on

`lib/pipeline/residential-sourcing.ts` needs, in ONE query per county: a
recently-sold filter (real, sortable sale/deed **date**), a single-family
class, market value, address, and parcel geometry. Harris (HCAD `new_owner_date`)
and Tarrant (TAD `DEED_DATE`) both provide this. Nothing else probed does.

## Per-county findings (live-probed 2026-07-13)

| Market / County | Layer | Sale-date field | Reality |
|---|---|---|---|
| Houston / Harris | HCAD Parcels | `new_owner_date` (epoch) | **USABLE** (in prod) |
| Fort Worth / Tarrant | TAD TADParcels | `DEED_DATE` (epoch) | **USABLE** (in prod) |
| Corpus / Nueces | bisconsulting CAD | `Deed_Date` **String** `"12/31/2025"` | unsortable, placeholder-heavy — **unusable** |
| Waco / McLennan | bisconsulting CAD | `Deed_Date` String | same schema — **unusable** |
| El Paso | bisconsulting CAD | `Deed_Date` String | same schema — **unusable** |
| Austin / Hays | bisconsulting CAD | `Deed_Date` String | same schema — **unusable** |
| Austin / Travis | taxmaps FeatureServer | `deed_date` (epoch) | real, but newest ≈ **Dec 2024** (~19 mo stale) — **too old** |
| Brownsville / Cameron | CCAD_Parcels_View | `deedDt`/`deedRecDt` **String** | **sentinel dates** (2088, 2077); real ones 2007–2018 — **unusable** |
| San Antonio / Bexar | BCAD_Parcels | — | no sale date on the ArcGIS layer |
| Dallas / Dallas Co. | Parcel_View | — | no public sale date (known) |
| Beaumont / Jefferson | JCAD_Parcels | `deed_num` only | no sale **date** — **unusable** |
| **Orlando / Orange FL** | statewide FDOR cadastral | `SALE_YR1`/`SALE_MO1` | data is real (2025 sales) BUT county-scoped queries **time out** (>50s; layer isn't indexed on `CO_NO`, and a tight spatial envelope + `DOR_UC` filter also times out). Month-granular + annual-roll-lagged. **Not viable for a county scan.** |
| Orlando / Orange (OCPA own) | `ocgis4.ocfl.net` `FR_ISO_Parcels`, `Public_Base/32`, `Public_Dynamic/217` | `SALE_DATE` (real Date!) | the clean layer exists with a great schema (SALE_DATE, DOR_CODE, TOTAL_MKT, beds/baths, geometry) but **query is permission-gated / "action not available"** — public metadata only |

## Why this happens

Texas CADs publish appraisal rolls (assessed value + geometry), where the
deed/sale date is a secondary, often free-text field — frequently a string,
a placeholder, or frozen. The FRESH Texas deed data lives in the **county-clerk
records portals** (GovOS/Kofile "PublicSearch", Tyler) — but those are
client-side React apps with no geometry/value, and El Paso + Travis gate them
behind Cloudflare Turnstile. Florida's clean county data (OCPA) is gated; its
open statewide roll is too slow to scan by county.

## The three real paths to "all markets" (pick one)

1. **Paid parcel-data vendor** (Regrid / ATTOM / CoreLogic). One API, all US
   counties, normalized recent-sale + owner + geometry. Fastest route to every
   market at once; recurring cost. This is what most multi-metro operators use
   and the honest recommendation if residential is a priority everywhere.
2. **County-clerk PublicSearch scraper fleet** (headless browser). Free and
   fresh, but a fragile per-county build; yields party names + legal only, so
   it needs a geocode + a CAD join for value/geometry. El Paso + Travis stay
   CAPTCHA-blocked. Non-CAPTCHA counties confirmed open: Bexar, Nueces,
   McLennan, Cameron, Jefferson, Dallas, Hidalgo (GovOS/Kofile), + McLennan
   (Tyler).
3. **Bulk roll ingestion** (FL DOR NAL files; TX CAD bulk exports). Free and
   complete, but coarse freshness (annual-ish) — weaker for a 60-day new-mover
   product, though fine as a floor.

Houston + Fort Worth stay on their working HCAD/TAD ArcGIS feeds regardless.
