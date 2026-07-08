# Residential expansion plan

How Greenkeep adds the residential lead product, building on the two branches
Jules (google-labs-jules[bot]) created 2026-07-07. Written the same night the
commercial shelf went from 11 to 91 leads — which changes Jules' plan in one
big way: **automated sourcing already exists**.

## What Jules built (inventory)

**Branch `residential-leads-foundation…` (commit af06185)**
- Schema: `residential_lead` / `residential_package` / package unlocks
- Signal scoring: new construction / CO / permit-completed = 100, recently
  sold = 80, listing events = 60, manual = 20 — × confidence (1.0/0.7/0.4)
- LTV estimator (base monthly × retention months + add-on probability)
- **Packaging model**: leads bundle by ZIP + subdivision into "Residential
  Opportunity Reports" — the right call; single homeowner leads are too small
  to sell individually, a bundle of 40 new-mover addresses is the product
- CSV import + package-builder scripts, buyer page `/buyers/residential`,
  operator page `/dashboard/residential`, unit tests, docs

**Branch `audit-fixes…` (commits 797819d, 9631be0)**
- Residential **direct-mail fulfillment** on Lob: mail-campaign schema, cost
  estimation, draft builder, provider abstraction with safe stubs, operator
  campaign UI at `/dashboard/residential/mail`, tests
- Plus general perf/atomicity audit fixes (needs re-review — most touched
  files have been rewritten since)

## Integration verdict: salvage the libs, regenerate the plumbing

Both branches fork ~28 squash-merges behind main. Do **not** merge them
wholesale:

1. **Cherry-pick the pure new files** — `lib/residential/*` (scoring, ltv,
   teaser, lob-mail, lob-provider), the residential pages, and both docs.
   These are new paths with few conflicts and carry all the product value.
2. **Regenerate schema + migrations on current main.** Both branches emit
   migration `0020`; main is at `0031`. Re-add Jules' tables to today's
   `schema.ts` and let drizzle number them fresh. Never replay the stale
   snapshots.
3. **Rebuild the marketplace surfaces on today's components** — the buyer
   dashboard, tier pricing, free-claim policy, and waterfall didn't exist when
   Jules forked. Residential packages should ride the same rails: a package is
   a "lead" with its own tier (see pricing below).
4. **Drop from the audit branch**: `dev_server*.log`, and re-derive the audit
   fixes against current code rather than merging them.

## The big upgrade to Jules' plan: supply is automated now

Jules' docs list "Automated Sourcing" as future work with CSV import as the
bridge. That future arrived on the commercial side tonight — the same feeds
supply residential signals with parameter changes, not new engineering:

| Jules signal | Automated source (already built) |
|---|---|
| Recently sold (80) | **HCAD transfers feed with `state_class A1/A2`** — same query, residential classes; bundle by ZIP instead of listing per-parcel |
| New construction / CO (100) | HCAD `new_construction` year-built deltas + builder-name parcels; TABS is commercial-only so this needs the CAD angle |
| Permit completed — pools/decks (100) | City permit sources (deferred on commercial side too) |
| Weeds citation | **311 feed already sees them and throws them away** — 158 residential citations skipped in one run tonight; a cited homeowner is a hot door-knock for a resi crew |
| Listings (60) | No clean public feed (MLS is licensed) — keep manual/CSV, lowest priority |

Sequencing: recently-sold + citations arrive nearly free; they alone can fill
ZIP packages weekly.

## Product & pricing (reuse tonight's machinery)

- A **package** is the sellable unit: ZIP + month, e.g. "77433 — June movers:
  42 addresses". Cap and exclusivity mirror the commercial 3-spot model.
- Tier by package size/quality with the same `leadTierFor` pattern: 40+
  fresh-signal addresses = premium, 15–40 = standard, small/stale = volume.
- **Direct-mail fulfillment is the attach**, not the lead: buyer unlocks a
  package, then pays Lob fulfillment per address (Jules' mail-campaign layer +
  our existing per-postcard Stripe flow). This is the residential analog of
  the commercial postcard button, and it's where the margin is.
- Buyer prospecting reuses the engine unchanged — the same landscapers buy
  both; resi-only shops (the `[resi?]` flag we already detect on homepages)
  become a TARGET list instead of a deprioritized one.

## Guardrails carried over

- Residential parcels never train the turf model (structural: no measurement
  rows are written by any residential flow — keep it that way).
- No mail to homeowners without operator approval; Lob provider stays stubbed
  until the operator arms it (Jules built the stub — keep the pattern).
- Homeowner addresses are the product; they appear only inside an unlocked
  report, never in teasers (same posture as commercial address protection).

## Sequence & gate

1. **Phase R0 (1–2 days)**: cherry-pick libs/pages, regenerate migrations,
   compile + tests green, pages render empty.
2. **Phase R1 (2–3 days)**: wire automated supply — A1/A2 transfer variant +
   311 residential citations → `residential_lead` rows; weekly package builder
   cron; operator review on `/dashboard/residential`.
3. **Phase R2 (2–3 days)**: sell it — tiers, cap, unlock via existing Stripe
   path; report page (addresses + signals + LTV math); buyer nav tab.
4. **Phase R3**: Lob mail attach on unlocked packages (Jules' fulfillment
   layer, armed).

**Gate:** same logic as DFW (docs/EXPANSION.md) — residential competes with
DFW for the next build slot. Residential wins if Houston buyers ask for it
(watch chat + campaign replies); DFW wins if commercial sell-through is
strong. Both reuse the same rails, so neither blocks the other technically.
