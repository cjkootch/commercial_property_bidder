# Residential Leads

The residential module sells **homeowner opportunity reports** — bundles of
recently-sold single-family addresses — to local home-service companies (lawn
care, pest control, cleaning, fencing). It shares nothing with the commercial
lead marketplace: separate tables, separate sourcing, separate money paths.

## Why property events, not turf measurement

Unlike the commercial product, residential parcels are unreliable to measure
automatically (tree cover, fences, small structures). Homeowner **transitions**
are the signal instead: a new owner hires services in their first months, so
the deed date is the product.

## Data model (all residential-only tables)

- `residential_lead` — one address + signal (`signal_type`, `signal_date`,
  `confidence`, `estimated_home_value`, `lot_size_sqft`, `subdivision_name`,
  provenance in `raw_source`).
- `residential_package` — a sellable bundle (name, geography, `price_cents`,
  `status`: draft → published → sold_out/archived, teaser in `signal_summary`).
- `residential_package_membership` — which leads are in which package.
- `residential_unlock` — a buyer's purchase; the delivered report is
  snapshotted in `dossier` at payment time, so it survives later lead edits.

The commercial funnel (`property`/`lead_unlock`, campaigns, scoring) never
reads these tables, and vice versa. Commercial sourcing rejects class-A1
(single-family) parcels; residential sourcing takes only A1.

## Scoring

`lib/residential/scoring.ts`: signal weight (new construction/CO/permit 100,
recently sold 80, listing events 60, manual 20) × confidence multiplier
(High 1.0 / Med 0.7 / Low 0.4). Package pricing
(`lib/residential/economics.ts`) sums quality points with a freshness decay
(14d = 1.0 → 90d+ = 0.15), floors packages at 15 addresses and $29.

## Sourcing

**Autopilot (primary):** `lib/pipeline/residential-sourcing.ts` pulls
recently-sold A1 homes ($250k+ county market value) from the HCAD parcel
layer — the same deed feed the commercial transfer pipeline reads. Dedupe is
on the HCAD account number in `raw_source`. Caveat learned live: the county
refreshes `new_owner_date` with the appraisal roll, so deed dates lag by
months; the fetch widens its window (60d → 180d → 365d) until it has real
volume and always takes the newest available. Freshness decay prices the lag
honestly, and sale dates print on the report.

**CSV import (manual):** `npm run residential:import -- path/to/leads.csv`
with columns `address, city, state, zip, subdivision_name, builder_name,
signal_type, signal_date, source, estimated_home_value, lot_size_sqft,
year_built, confidence, notes`.

## Packaging

`lib/pipeline/residential-packages.ts` groups unpackaged leads by
zip+subdivision (thin groups fall into a ZIP bundle), prices each through the
economics engine, and creates **draft** packages. Bundles under the 15-address
floor are held for the next cycle.

## Autopilot cron

`/api/cron/residential` (Mondays, see `vercel.json`) runs sourcing then
packaging. `?want=` caps sourcing volume; `?source=0` / `?package=0` skip a
phase. Auth: `Authorization: Bearer $CRON_SECRET`.

## Operator flow — `/packages`

Drafts land on the operator review desk. Publishing is the explicit approval
gate (same posture as campaign sends): set/override the price, then
**Publish** — the package appears on the buyer marketplace and opted-in
buyers within service range get a one-time alert email. Unpublish, mark sold
out, or archive any time; buyers who purchased keep their snapshotted report.

## Buyer flow — `/buyers/residential`

Marketplace shows published packages (teaser stats only — counts, ZIPs,
signal mix, expected-value range; never addresses). Purchase runs through
Stripe (`metadata.type = residential_package`); the webhook snapshots the
scored address dossier onto the unlock, emails the link, and converts
duplicate purchases to account credit (no-refunds policy, as disclosed).
The report page (`/buyers/residential/[id]`) shows the full address table
sorted by score, with a CSV download.
