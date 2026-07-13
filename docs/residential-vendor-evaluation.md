# Residential parcel-data vendor evaluation (2026-07-13)

Decision context: the free-ArcGIS pattern only yields usable recently-sold data
in Harris + Tarrant (see `residential-source-map.md`). To open residential in
every market with one integration, we evaluated a paid parcel-data vendor.

## What the pipeline actually needs (the scoring criteria)

`residential-sourcing.ts` sources a lead from, per county, in one query:
1. **Recently-sold filter** — a real sale/deed date, queryable by "last N days".
2. **Single-family class** — to reject commercial/land.
3. **Parcel geometry** — the product measures the yard from above; boundaries
   are non-negotiable, not a nice-to-have.
4. **Market value + address + year built** — pricing + the lead itself.
5. **Nationwide, one schema** — so every market is one adapter, not N.

## Regrid vs ATTOM

| Criterion | **Regrid** | **ATTOM** |
|---|---|---|
| Parcel **geometry** | Core product — precise boundaries on all 160M US parcels | Available (Boundaries endpoint) but secondary to transactions |
| Recently-sold query | Sales & Transfers attributes; attribute query by area | Purpose-built sales/recorder + sales-trend endpoints (query recent sales by geo + date) |
| Single-family class | Standardized Land Use (16 attrs) | Property-type filter |
| Value / owner / address | Assessment&Tax (8) + Ownership (11) + 73M standardized addresses | ~9,000 attrs/property incl. assessor |
| Coverage | 100% US parcels (+ Canada) | 158M+ US properties, 99% population |
| Schema | **One standardized nationwide schema** | Standardized, transaction-centric |
| Sale-date freshness | County-cycle (same as HCAD/TAD) | County-cycle; strong sales-history depth (10yr) |
| Access | Self-serve API, per-record pricing | **30-day free trial + instant key**; ~$95–500/mo |

## Recommendation: Regrid primary

For *this* product, **Regrid is the better fit** — parcel geometry is its core
and our product literally measures the parcel, so we get boundaries + class +
value + last-sale in ONE record with no second data source to join. It collapses
all the per-CAD adapters into a single nationwide source. Sale-date freshness is
county-cycle — the same lag we already accept for HCAD/TAD and handle with the
`FALLBACK_WINDOWS_DAYS` widening.

**ATTOM is the fallback / complement** if the spike shows Regrid's sale-date
freshness is too thin in our counties: ATTOM's recorder feed is transaction-first
(fresher recent-sales), and its 30-day free trial makes it the fastest thing to
spike *today*. A viable hybrid is ATTOM for the fresh recent-sale signal +
Regrid (or our existing CAD geometry) for the boundary — but prefer the
single-vendor Regrid path unless the spike forces the split.

## Drop-in integration design (no schema change)

Add one `vendor` source to `residential-sourcing.ts`'s `SOURCES` array that
replaces the per-CAD adapters for every non-Harris/Tarrant county:

- `fetchVendorSales({ countyFips, sinceDays, minValue, limit })` → the vendor's
  "sold since / land-use = SFR / value ≥ floor" query, per county FIPS.
- `normalizeVendorSale(record)` → the existing `ResidentialCandidate` shape
  (account = vendor parcel id; geometry center from the returned polygon).
- Drive the county list off the market registry (each market's counties + FIPS
  + state), so adding a metro is a registry entry, not new code.
- `state` becomes per-candidate (already needed for FL) — the insert at
  `residential-sourcing.ts:307` stops hard-coding `"TX"`.
- Dedupe key: `vendor:<parcel_id>` in `raw_source`, same pattern as `hcad`/`tad`.
- Keep Harris/Tarrant on their free ArcGIS feeds (no reason to pay for what
  works); the vendor covers everything else.

Cost is bounded: per-record pricing × `want` per county per run — we only pay
for parcels we actually source into leads.

## Spike checklist (run the moment we have a trial key)

For each target county (Bexar, Travis, Nueces, McLennan, El Paso, Cameron,
Jefferson, Dallas, Orange FL), verify against the LIVE vendor API:
1. Recently-sold volume in the last 60 / 180 days (is it fresh enough?).
2. Single-family filter returns clean SFR (spot-check 10 records).
3. Parcel geometry present + valid (we can compute a center + measure).
4. Value + address + year-built populated.
5. Cost per 1,000 sourced records → the per-market unit economics.

If Regrid clears 1–4 in our counties, build the single `vendor` source and open
every market at once. If sale-date freshness fails in ≥1 county, spike ATTOM's
recent-sales endpoint for those and decide hybrid vs. all-ATTOM.

## The one human action

**Obtain an API key** so the spike can run live:
- **ATTOM** — 30-day free trial + instant key (`api.developer.attomdata.com`):
  fastest to spike today, zero commitment.
- **Regrid** — self-serve API plan (`app.regrid.com/api/plans`): the recommended
  production path.

Get either key into the environment (e.g. `PARCEL_VENDOR_API_KEY`) and I'll run
the live spike across all target counties, then build the `vendor` source and
switch on residential for every market.
