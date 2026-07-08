# Market expansion plan

How Greenkeep adds a new metro, with DFW as the worked example. Written
2026-07 while the platform ran a single market (Houston / Harris County+).

## What we learned building Houston

Leads are nearly free once the funnel exists — one night of aperture-opening
took the shelf from 11 to 91 leads. **Buyers are the constraint, not leads.**
Expansion timing should be gated on buyer-side proof, not inventory ambition.

## What is actually market-specific

Every feed shares one funnel: signal → coordinates → **county parcel gate**
(class + owner + geometry) → grass/pavement screen → teaser → shelf. Only two
pieces vary by market:

| Component | Portability | DFW status (probed live 2026-07) |
|---|---|---|
| TABS construction permits | **Statewide** — add county IDs to `TABS_COUNTIES` | Dallas/Tarrant/Collin/Denton IDs: lookup, trivial |
| Sales-tax openings feed | **Statewide** — county codes on the same dataset | Codes 057/220/043/061 = **3,457 new outlets/30d** (bigger than Harris' 2,332) |
| Ownership transfers | **Per-CAD adapter** (schema quirks each time) | DCAD/TAD GIS need validation — no authoritative public layer surfaced on first probe; expect FBCAD-style quirks (string dates) |
| 311 violations | **Per-city adapter** | Dallas: live Socrata API `d7e7-envw`, updated daily — *easier* than Houston's flat file. Fort Worth separate. |
| Parcel lookup (`lib/integrations/parcel.ts`) | **Per-CAD adapter** — THE gating work item | DCAD + TAD adapters are the bulk of DFW engineering |
| Everything else (pricing tiers, ranking, allocation, waterfall, prospecting, postcards, microsites, ML turf model) | **Market-agnostic** | Zero changes expected; turf model may read Low confidence on unfamiliar imagery — acceptable, operator corrects |

Texas-first expansion is dramatically cheaper than out-of-state: any TX metro
keeps two of four feeds for free (TABS + Comptroller). Out-of-state loses both.

## The gate: when to pull the trigger

Do NOT start DFW until Houston shows, over ~60-90 days:

1. **≥ 20 paying buyer accounts** (proves the cold→claim→paid funnel)
2. **Measured conversion economics** (cost per activated account, repeat rate)
3. **Operator time per week known** — expansion doubles review load; if
   Houston review takes >1 day/week, build ops tooling first

## Build sequence for a new market (2–3 weeks elapsed)

**Phase 0 — market registry (one-time, before any second market).**
Introduce `lib/markets.ts`: `{ key, label, tabsCountyIds, comptrollerCountyCodes,
cadAdapters, violations311Source, anchorCity, bbox }`. Feeds iterate enabled
markets; properties get a `market` column; dashboards/crons filter by it.
Houston becomes the first registry entry, not the default.

**Phase 1 — data validation (2–3 days).** Same method as Houston: probe every
source live, document quirks in module headers, measure volumes before writing
features. For DFW: DCAD + TAD parcel/class/sale-date fields; Dallas 311 field
mapping; TABS county IDs; Collin/Denton CADs (optional at launch).

**Phase 2 — feeds live in shadow (1 week).** Run all feeds for the new market
with operator review; nothing marketed. Tune floors to local values, verify
teaser sanity on local labor costs (pricing config is per-company today; add a
per-market config override if DFW rates diverge >15%).

**Phase 3 — buyer side.** Apollo pool check for DFW landscapers (Houston had
~418 with web presence; DFW should exceed). Seed 2–3 anchor campaigns via the
existing prospecting engine (`market`-scoped). Email volume doubles: warm a
per-market sending subdomain or throttle to ≤30/day/market at first.

**Phase 4 — switch on.** Crons per market (staggered Mondays), offer blasts,
autosend once first replies are handled. Success = first DFW paid unlock
within 30 days of Phase 4.

## Metro order after DFW

San Antonio (Bexar CAD) → Austin (Travis/Williamson) — both keep the statewide
feeds and have single dominant CADs. Then re-evaluate out-of-state (needs a
permits + business-registration source per state; Florida and Georgia have
comparable open-data ecosystems).

## Standing risks

- **CAD schema drift** — every adapter needs a live-probe test and a loud log
  line when a field vanishes (see the HCAD outage lesson: never let a source
  failure read as "no candidates").
- **Sender reputation** — one shared domain across markets concentrates risk;
  per-market subdomains isolate it.
- **Operator bandwidth** is the real scaling limit until review tooling
  (bulk archive, batch approve) exists.
