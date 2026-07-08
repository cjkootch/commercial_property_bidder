# Multi-trade expansion thesis

The operator's insight (2026-07): the same lead sells to many trades. A
recently-sold home isn't a landscaping lead — it's a NEW MOVER, and movers
buy pest control, pool service, fencing, HVAC tune-ups, painting, cleaning,
security, and lawn care in their first 90 days. A commercial opening needs
janitorial, signage, security, and parking-lot striping alongside grounds.
The signal was never landscaping-specific; only our first buyer vertical was.

## Why the economics are exceptional

- **Marginal cost of a lead is ~$0** (one imagery tile at most; most trades
  need no measurement at all — cheaper than our landscaping funnel).
- **Trades don't compete**, so the 3-buyer cap applies PER TRADE: one mover
  address can carry 3 landscapers + 3 pest + 3 pool + 3 fence… The same
  package resells across verticals with zero cannibalization.
- Revenue per signal ≈ package price × number of live trade verticals. The
  sourcing machine we built this week is the moat; each new trade is a new
  monetization of the same pipe.

## What is already trade-agnostic (built this week)

Signals + feeds (transfers, openings, citations, permits), freshness/scoring/
package economics, claim funnel, waterfall, cooldowns, suppression, Stripe,
and the buyer-prospecting engine (the Apollo keyword list and the homepage
commercial-signal regex are the only landscaping-specific strings in it).

## What changes per trade

1. `buyer.trade` + `trade` on packages/offers (default `landscaping`;
   migration is trivial NOW, painful after thousands of rows).
2. **Signal→trade relevance map** (the new algorithm): mover → pest/pool/
   fence/cleaning/lawn; weeds citation → lawn (mostly); commercial opening →
   janitorial/signage/security/grounds; construction completion → everything.
3. Per-trade prospecting keyword packs + pitch copy (the engine already
   parameterizes; it's config).
4. Per-trade sheet content: landscaping gets measurement; other trades get a
   leaner "opportunity sheet" (address, signal, timing, owner) — which is
   cheaper to produce.

## Sequencing (don't dilute before the funnel is proven)

- **Now (cheap):** add the `trade` column + relevance map with everything
  defaulted to landscaping. Architecture cost ~a day; retrofit cost later is
  weeks.
- **After landscaping shows paid conversions** (same gate as DFW/residential):
  launch trade #2 = **pest control** — highest mover-affinity, zero
  measurement, huge operator density on Apollo.
- Trade #3+: pool service (ZIP-filterable by pool permits), fencing (new
  construction affinity), janitorial (commercial openings).
- Expansion math: trades multiply revenue per market; markets multiply
  signal volume. Do trades BEFORE new metros — same supply, new demand,
  no new CAD adapters.

## Guardrails

- Per-trade caps disclosed ("capped at 3 pest companies") — the scarcity
  promise stays honest because trades are disjoint.
- Homeowner data posture unchanged: addresses only inside unlocked products.
- Cooldowns are per-company and already trade-safe (company_key).
