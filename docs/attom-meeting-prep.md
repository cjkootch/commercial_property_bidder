# ATTOM meeting prep — questions that decide the residential build

Goal of the meeting: come away able to answer "can we source recently-sold
single-family homes, with geometry, across our counties, at a price that works —
and are we licensed to resell them as leads?" Everything below maps to a real
requirement in `residential-sourcing.ts` and `residential-vendor-evaluation.md`.

## The two make-or-break questions (ask these first)

1. **Recent-sales BY AREA query.** Can we pull *all* single-family sales in a
   county (or ZIP) recorded in the **last 30–60 days**, in one query/paginated
   set — not a lookup of one already-known property? Which endpoint? (We source
   by geography + recency; a property-by-property lookup API does not fit and
   changes the cost model completely.)

2. **Redistribution license.** We **resell** these addresses as lead lists to
   service companies. Does the license permit packaging/reselling *derived*
   leads (address + our own measurement + estimate) to third parties? Any field
   we may NOT redistribute? (This is the whole business — confirm it in writing.
   Many data licenses prohibit resale of raw records.)

## Data-fit questions

3. **Freshness / lag per county.** Typical lag from deed recording to API
   availability, specifically for: Bexar, Travis, Nueces, McLennan, El Paso,
   Cameron, Jefferson, Dallas (TX) and **Orange, FL**. Our product targets
   new movers in their first ~60 days — a 90+ day lag weakens it.

4. **Parcel geometry.** Does the sale record return the parcel **boundary
   polygon** (WKT/GeoJSON), or only a point/centroid? We measure the yard from
   above — a boundary is ideal; at minimum a reliable centroid + lot size.

5. **Single-family filter.** The property-type / land-use code(s) that isolate
   detached single-family (exclude condos, land, commercial).

6. **Fields in ONE response.** Confirm sale date, sale price, market/assessed
   value, situs address, year built, lot size, owner name all come back in the
   recent-sales response — or does each need a second enrichment call per
   property (a cost multiplier we must know about)?

## Commercial questions

7. **Pricing model.** Per-call, per-record, or monthly tier? Is a county-wide
   recent-sales pull one call or many paginated calls (each billed)? Ballpark
   for our shape: ~200 records/county/week across ~9 counties ≈ ~7–8k
   records/month — what's the monthly cost, API vs bulk?

8. **Trial limits.** The 30-day free trial: calls/day, endpoints included,
   geographies. Enough to spike all 9 counties (freshness + geometry + a
   10-record SFR spot-check each)?

9. **Rate limits & volume caps** on the production tier (calls/sec, monthly).

10. **Coverage confirmation.** All our counties covered by the **recorder/deed**
    feed (actual sale transactions), not just the assessor roll — including
    Orange County, FL.

## What "good" looks like (the go/no-go bar)

- A recent-sales-by-area endpoint returning SFR sales from the **last 60 days**
  with **< ~45-day** recording lag in our counties,
- with a parcel polygon or centroid + lot size,
- all needed fields in one response,
- a redistribution-permitting license,
- at a per-record cost that pencils against our lead prices.

Hit that and the build is a ~1–2 day `vendor` source drop-in + the per-county
spike; the integration design is already written. Get the trial key into the
env as `PARCEL_VENDOR_API_KEY` and I run the live spike immediately after.
