# Build Prompt: Commercial Landscaping Acquisition Engine (MVP v1)

Paste this whole file into Claude Code as the build spec. Treat it as the source of truth. Build in the phase order given, commit after each phase, and stop to report if any acceptance test fails.

---

## 1. Context

This is an internal sales tool for a commercial landscaping company expanding into commercial grounds-maintenance contracts in the NW Houston suburbs (Tomball / Spring / Cypress / Magnolia). It takes a commercial property, prices a recurring maintenance contract, finds the decision-makers, generates a proposal, and drafts a first-touch email. A human approves every outbound email. Nothing sends automatically.

This MVP intentionally excludes autonomous property sourcing and auto-measurement. Those come later. Leave clean integration seams (documented function stubs) where noted, but do not build them.

## 2. Goal

A deployable Next.js app where the operator can: add a property and its measurements, get an instant priced contract with review flags, enrich 2 to 3 ranked decision-maker contacts, generate a branded shareable proposal page, draft an outreach email, and move the property through a pipeline. Human gate before any send.

## 3. Stack (do not substitute)

- **Framework:** Next.js (App Router, TypeScript, Server Actions)
- **Styling:** Tailwind CSS. Clean, professional, not flashy.
- **DB:** Neon Postgres via Drizzle ORM + drizzle-kit migrations. Use the pooled connection string.
- **Auth:** Clerk, protecting all operator routes. Public proposal pages are unauthenticated. (If Clerk setup is a blocker, gate behind a single shared-secret middleware and leave a TODO. Do not ship the operator UI fully public.)
- **Email:** Resend (with React Email templates). Send only from a verified domain.
- **Contact data:** Apollo REST API (`APOLLO_API_KEY`).
- **Host:** Vercel. Assume serverless; no long-running processes, no Puppeteer.
- **Repo:** GitHub under `cjkootch`. Initialize, commit per phase, push.

## 4. Data model (Drizzle schema)

Use UUID primary keys, `created_at`/`updated_at` timestamps on every table.

- **company** (one row for MVP, but real table): `name, address, city, zip, phone, email, logo_url, brand_color, gl_insurance_amount, coi_available (bool), booking_url, physical_mailing_address` (for CAN-SPAM footer), `service_area_notes`.
- **pricing_config**: one active row per company. All engine inputs in section 5, plus `is_active (bool)`, `version (int)`. Never mutate; insert a new version and flip `is_active`.
- **property**: `company_id, name, address, city, zip, lat, lng, icp_type (enum: self_storage | office_park | medical | church | daycare | retail_strip | industrial | other), owner_org (text, the entity that controls grounds maintenance), source (enum: manual | places), status (enum, see pipeline below), notes`.
- **measurement**: `property_id, turf_sqft, bed_sqft, shrub_count, tree_count, edging_lf, complexity (numeric default 1.0), confidence (enum: High | Med | Low), source (enum: manual | siterecon), measured_at`.
- **pricing_result**: `property_id, measurement_id, config_id, cost_per_visit, price_per_visit, gross_profit_per_visit, gross_margin_pct, min_acceptable_price, monthly_price, annual_price, annual_gross_profit, cole_annual_cut, implied_per_acre_visit, crew_hours_per_visit, flags (jsonb), needs_review (bool), computed_at`.
- **contact**: `property_id, full_name, title, email, phone, apollo_id, priority_rank (int), source (enum: apollo | manual)`.
- **proposal**: `property_id, pricing_result_id, slug (unique), frequency_options (jsonb), scope_items (jsonb), status (enum: draft | sent | viewed), viewed_at`.
- **outreach**: `property_id, contact_id, proposal_id, subject, body, status (enum: draft | approved | sent | replied | bounced | unsubscribed), resend_message_id, sent_at, replied_at`.
- **suppression**: `email (unique), reason, created_at`. Checked before every send.

**property.status pipeline enum (ordered):** `sourced → priced → contacts_enriched → proposal_ready → outreach_drafted → sent → replied → walkthrough_booked → won → lost`.

## 5. Pricing engine (the core, port exactly)

Implement as a **pure, dependency-free function** `computePricing(measurement, config)` in `lib/pricing/engine.ts`. No DB calls inside it. Write unit tests (Vitest) that assert the three fixtures in section 5.3 to 2 decimals. This function must reproduce the spreadsheet exactly.

### 5.1 Config fields and default seed values

```
crew_size                       = 3
labor_cost_per_person_hour      = 22      // USD
equipment_cost_per_crew_hour    = 30      // USD
turf_min_per_acre               = 38      // crew-minutes
bed_min_per_1000sqft            = 4       // crew-minutes
fixed_min_per_stop              = 10      // crew-minutes
drive_min_per_stop              = 10      // crew-minutes
target_margin                   = 0.40
margin_floor                    = 0.35
min_price_per_visit             = 70      // USD
visits_per_year                 = 40
cole_profit_share               = 0.50
max_turf_acres                  = 3.0
bed_turf_ratio_threshold        = 0.20
monthly_review_threshold        = 1500    // USD
market_floor_per_acre_visit     = 50      // USD
market_ceiling_per_acre_visit   = 150     // USD
```

`crew_cost_per_hour = crew_size * labor_cost_per_person_hour + equipment_cost_per_crew_hour` (defaults to 96).

### 5.2 Calculation (exact order)

```
turf_acres            = turf_sqft / 43560
turf_time             = turf_acres * turf_min_per_acre * complexity
bed_time              = (bed_sqft / 1000) * bed_min_per_1000sqft * complexity
total_crew_min        = turf_time + bed_time + fixed_min_per_stop + drive_min_per_stop
crew_hours_per_visit  = total_crew_min / 60
cost_per_visit        = crew_hours_per_visit * crew_cost_per_hour
price_per_visit       = max(cost_per_visit / (1 - target_margin), min_price_per_visit)
gross_profit_per_visit= price_per_visit - cost_per_visit
gross_margin_pct      = gross_profit_per_visit / price_per_visit
min_acceptable_price  = max(cost_per_visit / (1 - margin_floor), min_price_per_visit)
monthly_price         = price_per_visit * visits_per_year / 12
annual_price          = price_per_visit * visits_per_year
annual_gross_profit   = gross_profit_per_visit * visits_per_year
cole_annual_cut       = annual_gross_profit * cole_profit_share
implied_per_acre_visit= turf_acres > 0 ? price_per_visit / turf_acres : null
```

**Flags** (each boolean; `needs_review = OR of all`):
```
large         = turf_acres > max_turf_acres
bed_heavy     = turf_sqft > 0 && (bed_sqft / turf_sqft) > bed_turf_ratio_threshold
high_value    = monthly_price > monthly_review_threshold
low_confidence= confidence == 'Low'
below_market  = turf_acres >= 1 && implied_per_acre_visit < market_floor_per_acre_visit
above_market  = turf_acres >= 1 && implied_per_acre_visit > market_ceiling_per_acre_visit
```
Store `flags` as `{ large, bed_heavy, high_value, low_confidence, below_market, above_market }` plus a human-readable `reasons: string[]`.

### 5.3 Test fixtures (must pass)

Using default config:

| Property | turf | bed | complexity | conf | price/visit | monthly | margin | cole_cut/yr | needs_review |
|---|---|---|---|---|---|---|---|---|---|
| Self-storage | 35000 | 1500 | 1.0 | High | 150.75 | 502.51 | 0.40 | 1206.03 | false |
| Office park | 18000 | 4000 | 1.2 | High | 154.78 | 515.94 | 0.40 | 1238.25 | true (bed_heavy) |
| Church | 90000 | 2000 | 1.0 | Med | 284.04 | 946.79 | 0.40 | 2272.27 | false |

(Self-storage implied $/acre/visit is ~187 but the lot is under 1 acre, so below/above-market flags must NOT fire. Verify that.)

## 6. Integrations

### 6.1 Apollo (contact enrichment)
- Server action `enrichContacts(propertyId)`. Use Apollo People Search filtered by the property's `owner_org` (company name) and a ranked title list. Return at most 3, deduped, with emails where available.
- **Title priority ranking** (assign `priority_rank` 1 = best): Property Manager, Facilities Manager, Operations Manager, Office Manager, Owner/Principal, Asset Manager, Regional Manager.
- Persist `apollo_id`. Note that email/phone reveal consumes Apollo credits; do not bulk-reveal beyond the top 3.
- If `owner_org` is empty, do not call Apollo. Surface a UI prompt that the operator must confirm the grounds-controlling entity first. This is the deliberate confidence gate on the owner-to-decision-maker hop. Do not auto-resolve it.

### 6.2 Resend (outreach)
- Server action `draftOutreach(propertyId, contactId)` generates subject + body (no send). Tone: consultative, low-pressure. CTA is a 15-minute walkthrough, never sign-or-pay. Include the proposal page link and the measured areas. Pull the operator-set copy template from a `lib/templates` module so it is editable.
- Server action `sendOutreach(outreachId)`: **guarded.** Refuse to send if (a) the property's `needs_review` is true and an operator has not set an `acknowledged_review` flag in the UI, (b) the recipient email is in `suppression`, or (c) the domain is unverified. Send via Resend, store `resend_message_id`, set status `sent`, advance pipeline.
- Every email must include the company physical mailing address and a working unsubscribe link (route `/api/unsubscribe?token=...` that inserts into `suppression`). This is CAN-SPAM baseline.
- Add `/api/webhooks/resend` to log delivery, opens, and bounces. Reply detection can be a stub that just logs for now.

### 6.3 Proposal page
- `generateProposal(propertyId)` creates a `proposal` row with a unique slug, default `frequency_options` (weekly in-season annualized monthly, plus a biweekly option), and `scope_items` (mow, edge, trim, blow, bed weed-and-check, seasonal cleanup note).
- Public route `/proposals/[slug]`: branded server component showing property address, a measured-areas summary, scope, the frequency options with monthly price, a short insurance/reliability statement (pull `gl_insurance_amount`), and a CTA button linking to `company.booking_url`. On first GET, set `viewed_at` and status `viewed`.

## 7. Operator UI / routes

- `/dashboard`: pipeline view (table or kanban) grouped by status. Header metrics: count per stage, total annual pipeline value (sum of `annual_price` for non-lost), and projected Cole cut (sum of `cole_annual_cut`). Properties with `needs_review` badged.
- `/properties/new`: add property (name, address, icp_type, owner_org).
- `/properties/[id]`: the workspace. Sections: measurements form (recompute pricing on save), pricing result card with flags and the `acknowledged_review` checkbox, contacts (Enrich button + manual add), proposal (Generate + view link), outreach (Draft, edit, approve, Send). Send button disabled until gates in 6.2 pass.
- `/config`: edit the active `pricing_config` (writes a new version). Show the seeded defaults.
- Seed script: one `company`, one active `pricing_config` with the section 5.1 defaults, and the three section 5.3 properties with measurements so the dashboard is non-empty on first run.

## 8. Build order (commit after each)

1. Repo init, Next.js + TS + Tailwind + Clerk + Drizzle wired to Neon. Env scaffold. Push.
2. Schema + migrations + seed. Verify tables in Neon.
3. Pricing engine + Vitest fixtures. **Do not proceed until all three pass.**
4. Property intake + measurement form + auto-pricing + flags UI.
5. Apollo enrichment + contacts UI + the owner_org confidence gate.
6. Proposal generation + public proposal page + view tracking.
7. Resend outreach drafting + the guarded send + unsubscribe + suppression + webhook.
8. Dashboard + pipeline metrics. README with setup, env, and deploy steps.

## 9. Guardrails (non-negotiable)

- No email sends without explicit operator approval in the UI. No background/cron sending.
- `needs_review = true` blocks send until `acknowledged_review` is set.
- Never reveal more than 3 Apollo contacts per property without an explicit operator action.
- All sends check the suppression list and require a verified Resend domain.
- Treat `owner_org` as operator-supplied truth. Do not infer the grounds-controlling entity from the tenant automatically.

## 10. Env vars

```
DATABASE_URL=                  # Neon pooled
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
APOLLO_API_KEY=
RESEND_API_KEY=
RESEND_FROM_EMAIL=             # on the verified domain
NEXT_PUBLIC_APP_URL=           # for proposal links
```

## 11. Acceptance criteria

- `npm run test` passes, including the three pricing fixtures to 2 decimals.
- Seeded dashboard renders with three properties, correct prices, and the office park badged for review.
- Adding a property, entering measurements, and saving produces a stored `pricing_result` with flags.
- Enrich pulls ranked contacts for a property with a populated `owner_org`, and refuses politely when it is empty.
- A proposal page renders at its slug and records `viewed_at` on first visit.
- An outreach email can be drafted and sent only after gates pass, lands from the verified domain, and includes address + unsubscribe.
- `README.md` documents local setup, env, migrations, seed, and Vercel deploy.

## 12. Seams to leave (stub + TODO, do not build)

- `lib/integrations/siterecon.ts` with `fetchMeasurement(address)` throwing `NotImplemented`, so measurement source can flip from manual to API later.
- `lib/integrations/places.ts` and `lib/integrations/parcel.ts` stubs for future autonomous sourcing and owner-of-record resolution.
- A `tenant_id` column note in the schema comments so multi-tenant is a migration, not a rewrite.
