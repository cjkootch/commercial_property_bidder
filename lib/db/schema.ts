import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  doublePrecision,
  timestamp,
  jsonb,
  numeric,
  primaryKey,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// MULTI-TENANCY SEAM (build spec section 12)
// Every table is single-tenant for the MVP. When multi-tenant is needed, add a
// `tenant_id uuid` column here (FK to a future `tenant` table) plus a row-level
// filter in the db layer. It is deliberately a migration, not a rewrite — no
// code below assumes a single tenant beyond the seed.
// ---------------------------------------------------------------------------

// Reusable timestamp columns. updated_at must be touched on write by the app
// layer (Drizzle has no portable ON UPDATE trigger here).
const timestamps = {
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// --- Enums ---------------------------------------------------------------

export const icpTypeEnum = pgEnum("icp_type", [
  "self_storage",
  "office_park",
  "medical",
  "church",
  "daycare",
  "retail_strip",
  "industrial",
  "residential",
  "other",
]);

export const propertySourceEnum = pgEnum("property_source", ["manual", "places", "inbound"]);

// Ordered pipeline (build spec section 4).
export const propertyStatusEnum = pgEnum("property_status", [
  "sourced",
  "priced",
  "contacts_enriched",
  "proposal_ready",
  "outreach_drafted",
  "sent",
  "replied",
  "walkthrough_booked",
  "won",
  "lost",
]);

export const confidenceEnum = pgEnum("confidence", ["High", "Med", "Low"]);

export const measurementSourceEnum = pgEnum("measurement_source", [
  "manual",
  "siterecon",
  "map_draw",
  "ml_pred",
]);

export const contactSourceEnum = pgEnum("contact_source", ["apollo", "manual"]);

export const proposalStatusEnum = pgEnum("proposal_status", [
  "draft",
  "sent",
  "viewed",
  "accepted",
]);

export const outreachStatusEnum = pgEnum("outreach_status", [
  "draft",
  "approved",
  "sent",
  "replied",
  "bounced",
  "unsubscribed",
]);

// Buyer self-serve prospect lifecycle (bring-your-own address → scan → quote →
// microsite → postcard). Kept entirely separate from the operator pipeline.
export const prospectStatusEnum = pgEnum("prospect_status", [
  "added", // geocoded only
  "scanned", // parcel + veg + aerial + price cached
  "mailed", // postcard created via Lob
  "viewed", // branded microsite opened >= 1
  "archived", // soft-deleted; retains a mailed postcard's microsite
]);

// --- company -------------------------------------------------------------

export const company = pgTable("company", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // White-label tenant slug: <slug>.<TENANT_ROOT_DOMAIN> serves this company's
  // branded public funnel (see lib/tenant.ts). Null = never served by subdomain
  // (the apex/default company doesn't need one).
  slug: text("slug").unique(),
  address: text("address"),
  city: text("city"),
  zip: text("zip"),
  phone: text("phone"),
  email: text("email"),
  logo_url: text("logo_url"),
  brand_color: text("brand_color"),
  gl_insurance_amount: integer("gl_insurance_amount"),
  coi_available: boolean("coi_available").notNull().default(false),
  booking_url: text("booking_url"),
  // Used for the CAN-SPAM footer on outreach emails.
  physical_mailing_address: text("physical_mailing_address"),
  service_area_notes: text("service_area_notes"),
  ...timestamps,
});

// --- pricing_config ------------------------------------------------------
// Never mutate a row: insert a new version and flip is_active. Money/rate
// inputs mirror lib/pricing/types.ts PricingConfig (build spec section 5.1).

export const pricingConfig = pgTable("pricing_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  company_id: uuid("company_id")
    .notNull()
    .references(() => company.id),
  crew_size: integer("crew_size").notNull(),
  labor_cost_per_person_hour: doublePrecision("labor_cost_per_person_hour").notNull(),
  equipment_cost_per_crew_hour: doublePrecision("equipment_cost_per_crew_hour").notNull(),
  turf_min_per_acre: doublePrecision("turf_min_per_acre").notNull(),
  bed_min_per_1000sqft: doublePrecision("bed_min_per_1000sqft").notNull(),
  fixed_min_per_stop: doublePrecision("fixed_min_per_stop").notNull(),
  drive_min_per_stop: doublePrecision("drive_min_per_stop").notNull(),
  target_margin: doublePrecision("target_margin").notNull(),
  margin_floor: doublePrecision("margin_floor").notNull(),
  min_price_per_visit: doublePrecision("min_price_per_visit").notNull(),
  visits_per_year: integer("visits_per_year").notNull(),
  cole_profit_share: doublePrecision("cole_profit_share").notNull(),
  max_turf_acres: doublePrecision("max_turf_acres").notNull(),
  bed_turf_ratio_threshold: doublePrecision("bed_turf_ratio_threshold").notNull(),
  monthly_review_threshold: doublePrecision("monthly_review_threshold").notNull(),
  market_floor_per_acre_visit: doublePrecision("market_floor_per_acre_visit").notNull(),
  market_ceiling_per_acre_visit: doublePrecision("market_ceiling_per_acre_visit").notNull(),
  is_active: boolean("is_active").notNull().default(true),
  version: integer("version").notNull().default(1),
  ...timestamps,
});

// --- property ------------------------------------------------------------

export const property = pgTable("property", {
  id: uuid("id").primaryKey().defaultRandom(),
  company_id: uuid("company_id")
    .notNull()
    .references(() => company.id),
  name: text("name").notNull(),
  address: text("address"),
  city: text("city"),
  zip: text("zip"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  icp_type: icpTypeEnum("icp_type").notNull().default("other"),
  // The entity that controls grounds maintenance. Operator-supplied truth — we
  // never infer it from the tenant (build spec section 9).
  owner_org: text("owner_org"),
  source: propertySourceEnum("source").notNull().default("manual"),
  status: propertyStatusEnum("status").notNull().default("sourced"),
  // Operator must tick this before an email can be sent on a needs_review
  // property (build spec section 6.2 send gate).
  acknowledged_review: boolean("acknowledged_review").notNull().default(false),
  // Cached county parcel boundary + owner-of-record (lib/geo/types ParcelResult)
  // fetched lazily from county GIS. Reference overlay for the map; owner is a
  // suggestion only, never auto-applied to owner_org.
  parcel_geojson: jsonb("parcel_geojson"),
  // Cached OSM-detected features (buildings/parking/tree canopy) within the
  // parcel — suggestions the operator adjusts on the map.
  osm_features: jsonb("osm_features"),
  // Cheap RGB pre-screen: vegetated (≈ grass) share of the parcel in [0, 1],
  // computed before the full measure pass. Null until screened. Drives the
  // sourcing "qualified" gate (see lib/sourcing/criteria.ts).
  grass_fraction: doublePrecision("grass_fraction"),
  // Suggested ownership company (parcel owner-of-record seed + Apollo enrichment).
  // A SUGGESTION only — the operator confirms it into owner_org; never
  // auto-applied (build spec section 9). See lib/integrations/apollo.ts.
  owner_suggestion: jsonb("owner_suggestion"),
  // Suggested digital contact (free OSM tags + website scrape): phone/email/
  // website. A SUGGESTION the operator confirms into a contact before any send.
  contact_suggestion: jsonb("contact_suggestion"),
  // Operator-set buying signal: the property is actively marketed for lease / has
  // a new property manager (spotted via a sign or listing). No reliable free API
  // for this, so it's a manual flag.
  actively_leasing: boolean("actively_leasing").notNull().default(false),
  // Lead marketplace: stamped when this property is exported as a sellable lead
  // (sold once — exported leads are excluded from future packages). Sold leads
  // carry PUBLIC-RECORD data only; see lib/leads/package.ts.
  lead_exported_at: timestamp("lead_exported_at"),
  // Marketplace teaser snapshot ({annual_lo, annual_hi, turf_sqft, projected,
  // computed_at}) — sized ONCE at sourcing so dashboard cards can show the
  // contract value without spending imagery quota per view.
  lead_teaser: jsonb("lead_teaser"),
  lead_buyer: text("lead_buyer"),
  notes: text("notes"),
  ...timestamps,
});

// --- measurement ---------------------------------------------------------

export const measurement = pgTable("measurement", {
  id: uuid("id").primaryKey().defaultRandom(),
  property_id: uuid("property_id")
    .notNull()
    .references(() => property.id),
  turf_sqft: doublePrecision("turf_sqft").notNull(),
  bed_sqft: doublePrecision("bed_sqft").notNull(),
  shrub_count: integer("shrub_count"),
  tree_count: integer("tree_count"),
  edging_lf: doublePrecision("edging_lf"),
  complexity: numeric("complexity", { precision: 4, scale: 2 }).notNull().default("1.00"),
  confidence: confidenceEnum("confidence").notNull().default("Med"),
  source: measurementSourceEnum("source").notNull().default("manual"),
  // Drawn service-area polygons (GeoJSON FeatureCollection; each feature tagged
  // with properties.kind in turf|bed|exclude + properties.area_sqft) when the
  // measurement came from the map workspace. See lib/geo/types.ts.
  service_areas: jsonb("service_areas"),
  // Persisted map camera ({ center:[lng,lat], zoom }) so the audit view
  // re-renders at the same framing.
  map_view: jsonb("map_view"),
  measured_at: timestamp("measured_at", { withTimezone: true }).notNull().defaultNow(),
  ...timestamps,
});

// --- pricing_result ------------------------------------------------------
// A snapshot of the engine output for a (measurement, config) pair. `flags` is
// the PricingFlags object including the human-readable `reasons` array.

export const pricingResult = pgTable("pricing_result", {
  id: uuid("id").primaryKey().defaultRandom(),
  property_id: uuid("property_id")
    .notNull()
    .references(() => property.id),
  measurement_id: uuid("measurement_id")
    .notNull()
    .references(() => measurement.id),
  config_id: uuid("config_id")
    .notNull()
    .references(() => pricingConfig.id),
  cost_per_visit: doublePrecision("cost_per_visit").notNull(),
  price_per_visit: doublePrecision("price_per_visit").notNull(),
  gross_profit_per_visit: doublePrecision("gross_profit_per_visit").notNull(),
  gross_margin_pct: doublePrecision("gross_margin_pct").notNull(),
  min_acceptable_price: doublePrecision("min_acceptable_price").notNull(),
  monthly_price: doublePrecision("monthly_price").notNull(),
  annual_price: doublePrecision("annual_price").notNull(),
  annual_gross_profit: doublePrecision("annual_gross_profit").notNull(),
  cole_annual_cut: doublePrecision("cole_annual_cut").notNull(),
  implied_per_acre_visit: doublePrecision("implied_per_acre_visit"),
  crew_hours_per_visit: doublePrecision("crew_hours_per_visit").notNull(),
  flags: jsonb("flags").notNull(),
  needs_review: boolean("needs_review").notNull().default(false),
  computed_at: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  ...timestamps,
});

// --- contact -------------------------------------------------------------

export const contact = pgTable("contact", {
  id: uuid("id").primaryKey().defaultRandom(),
  property_id: uuid("property_id")
    .notNull()
    .references(() => property.id),
  full_name: text("full_name").notNull(),
  title: text("title"),
  email: text("email"),
  phone: text("phone"),
  apollo_id: text("apollo_id"),
  priority_rank: integer("priority_rank"),
  source: contactSourceEnum("source").notNull().default("apollo"),
  ...timestamps,
});

// --- proposal ------------------------------------------------------------

export const proposal = pgTable("proposal", {
  id: uuid("id").primaryKey().defaultRandom(),
  property_id: uuid("property_id")
    .notNull()
    .references(() => property.id),
  pricing_result_id: uuid("pricing_result_id")
    .notNull()
    .references(() => pricingResult.id),
  slug: text("slug").notNull().unique(),
  frequency_options: jsonb("frequency_options").notNull(),
  scope_items: jsonb("scope_items").notNull(),
  status: proposalStatusEnum("status").notNull().default("draft"),
  viewed_at: timestamp("viewed_at", { withTimezone: true }),
  // Open tracking for the hosted link. last_viewed_at + view_count power the
  // open-rate metric; per-open rows live in proposal_view.
  view_count: integer("view_count").notNull().default(0),
  last_viewed_at: timestamp("last_viewed_at", { withTimezone: true }),
  // Customer actions from the portal (magic-link authenticated).
  accepted_at: timestamp("accepted_at", { withTimezone: true }),
  walkthrough_requested_at: timestamp("walkthrough_requested_at", { withTimezone: true }),
  ...timestamps,
});

// --- proposal_view -------------------------------------------------------
// One row per open of a hosted proposal link, for open-rate / recency.

export const proposalView = pgTable("proposal_view", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposal_id: uuid("proposal_id")
    .notNull()
    .references(() => proposal.id),
  user_agent: text("user_agent"),
  viewed_at: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- outreach ------------------------------------------------------------

export const outreach = pgTable("outreach", {
  id: uuid("id").primaryKey().defaultRandom(),
  property_id: uuid("property_id")
    .notNull()
    .references(() => property.id),
  contact_id: uuid("contact_id")
    .notNull()
    .references(() => contact.id),
  proposal_id: uuid("proposal_id").references(() => proposal.id),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: outreachStatusEnum("status").notNull().default("draft"),
  resend_message_id: text("resend_message_id"),
  sent_at: timestamp("sent_at", { withTimezone: true }),
  replied_at: timestamp("replied_at", { withTimezone: true }),
  // Resend webhook tracking (email.delivered/opened/clicked/bounced/complained).
  delivered_at: timestamp("delivered_at", { withTimezone: true }),
  opened_at: timestamp("opened_at", { withTimezone: true }),
  clicked_at: timestamp("clicked_at", { withTimezone: true }),
  open_count: integer("open_count").notNull().default(0),
  click_count: integer("click_count").notNull().default(0),
  last_event: text("last_event"),
  ...timestamps,
});

// --- suppression ---------------------------------------------------------
// Checked before every send (build spec section 9). Email is unique.

export const suppression = pgTable("suppression", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  reason: text("reason"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- lead buyers (the job-intelligence marketplace) -------------------------
// A buyer = a landscaping company that claimed a free lead through a campaign
// link (or signed up later). Creating a profile is the opt-in for new-lead
// notifications; unsubscribes land in `suppression` like all email.

export const buyer = pgTable("buyer", {
  id: uuid("id").primaryKey().defaultRandom(),
  company_name: text("company_name").notNull(),
  email: text("email").notNull().unique(),
  city: text("city"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  notify: boolean("notify").notNull().default(true),
  // Landscaper profile — fills the [NAME]/[PHONE]/[EMAIL]/[YOUR COMPANY]/
  // [LICENSE] placeholders in every job sheet's ready-to-send intro letter, so
  // the outreach is theirs the moment they open it. Substituted at render time
  // from the live profile (editing it updates all their letters).
  contact_name: text("contact_name"),
  phone: text("phone"),
  website: text("website"),
  license_number: text("license_number"),
  // Office address (geocoded to lat/lng) + how far they'll travel. The radius
  // anchors the "open near you" distances and the coverage map on the profile.
  address: text("address"),
  // USPS ZIP resolved from the office address at geocode time — the return ZIP
  // on any postcard they mail (so it's never a placeholder).
  zip: text("zip"),
  service_radius_mi: integer("service_radius_mi").notNull().default(25),
  service_area: text("service_area"),
  bio: text("bio"),
  // Company logo (Vercel Blob URL) — printed on the postcard they mail.
  logo_url: text("logo_url"),
  // No-refunds policy: when a paid lead can't be delivered (sold out mid-
  // payment, duplicate purchase), the money becomes account credit that
  // auto-applies to the next unlock. Disclosed at the point of sale.
  credit_cents: integer("credit_cents").notNull().default(0),
  ...timestamps,
});

// One row per revealed lead per buyer. `dossier` is a SNAPSHOT taken at unlock
// time (contacts, sizing, route intel, bid window, intro letter) so viewing a
// lead never re-spends imagery/API quota and the buyer keeps what they bought
// even if the source data shifts. Scarcity model (lib/leads/availability.ts):
// a lead sells to at most LEAD_MAX_BUYERS companies (shared), or one buyer
// pays the exclusive premium to close it. A buyer never buys the same lead
// twice (unique property_id + buyer_id).
export const leadUnlock = pgTable(
  "lead_unlock",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buyer_id: uuid("buyer_id")
      .notNull()
      .references(() => buyer.id),
    property_id: uuid("property_id")
      .notNull()
      .references(() => property.id),
    kind: text("kind").notNull().default("free"), // free | paid | exclusive
    price_cents: integer("price_cents").notNull().default(0),
    stripe_session_id: text("stripe_session_id"),
    dossier: jsonb("dossier"),
    // Outreach pipeline the buyer drives on each lead — turns Greenkeep into
    // their CRM (stickiness) and gives us win/loss signal for pricing.
    // new | letter_sent | postcard_sent | contacted | bidding | won | lost
    outreach_status: text("outreach_status").notNull().default("new"),
    ...timestamps,
  },
  (t) => [unique("lead_unlock_property_buyer").on(t.property_id, t.buyer_id)]
);

// Append-only activity log per unlocked lead: status changes, notes, and
// postcard mailings. Powers the timeline on the sheet.
export const leadActivity = pgTable("lead_activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  unlock_id: uuid("unlock_id")
    .notNull()
    .references(() => leadUnlock.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // status | note | postcard
  detail: text("detail").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Postcards mailed via Lob (paid, one-click). Idempotent on stripe_session_id so
// a webhook retry never double-mails. A card targets EITHER a marketplace lead
// (`unlock_id`) OR a buyer self-serve prospect (`prospect_id`) — never both,
// never neither (enforced by the XOR check). `prospect_id` uses SET NULL so a
// mailed card (and its live microsite QR) survives the prospect being archived.
export const postcard = pgTable(
  "postcard",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unlock_id: uuid("unlock_id").references(() => leadUnlock.id, { onDelete: "cascade" }),
    prospect_id: uuid("prospect_id").references(() => prospect.id, { onDelete: "set null" }),
    buyer_id: uuid("buyer_id")
      .notNull()
      .references(() => buyer.id),
    lob_id: text("lob_id"),
    status: text("status").notNull().default("created"), // created | failed
    price_cents: integer("price_cents").notNull().default(0),
    stripe_session_id: text("stripe_session_id").unique(),
    to_name: text("to_name"),
    to_address: text("to_address"),
    expected_delivery: text("expected_delivery"),
    ...timestamps,
  },
  (t) => [
    // A card targets a lead OR a prospect — never both. (Both-null is tolerated
    // only as a post-deletion orphan: ON DELETE SET NULL nulls prospect_id when a
    // prospect/buyer is removed, and Postgres re-checks this on that UPDATE.)
    check(
      "postcard_target_xor",
      sql`NOT (${t.unlock_id} IS NOT NULL AND ${t.prospect_id} IS NOT NULL)`
    ),
  ]
);

// --- buyer self-serve prospecting ------------------------------------------
// A buyer's own target property. We scan (parcel + aerial + vegetation), quote
// it with the operator pricing engine (an ESTIMATE; the buyer may override), let
// them adjust the service area on the map, and mail a branded postcard that
// drives to the hosted microsite at /quote/<proposal_slug>.
//
// TRAINING ISOLATION: buyer-drawn `service_areas` live ONLY here — never in the
// `measurement`/`property` tables the ML export reads — so buyer edits can never
// enter the training set. Measurement + pricing are inlined on the row (no
// operator measurement/pricing_result rows are created).
export const prospect = pgTable(
  "prospect",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buyer_id: uuid("buyer_id")
      .notNull()
      .references(() => buyer.id, { onDelete: "cascade" }),
    name: text("name"),
    address: text("address").notNull(),
    city: text("city"),
    zip: text("zip"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    status: prospectStatusEnum("status").notNull().default("added"),
    // Cached scan artifacts (buyer-private; never written to property/measurement).
    parcel_geojson: jsonb("parcel_geojson"), // ParcelResult
    service_areas: jsonb("service_areas"), // ServiceAreaCollection (buyer-drawn)
    map_view: jsonb("map_view"), // MapView
    aerial: jsonb("aerial"), // DossierAerial
    // Inlined measurement snapshot.
    turf_sqft: doublePrecision("turf_sqft"),
    bed_sqft: doublePrecision("bed_sqft"),
    complexity: numeric("complexity", { precision: 4, scale: 2 }).notNull().default("1.00"),
    confidence: confidenceEnum("confidence").notNull().default("Med"),
    // Inlined pricing snapshot (operator config estimate).
    price_per_visit: doublePrecision("price_per_visit"),
    monthly_price: doublePrecision("monthly_price"),
    annual_price: doublePrecision("annual_price"),
    estimate_lo: doublePrecision("estimate_lo"),
    estimate_hi: doublePrecision("estimate_hi"),
    price_override_cents: integer("price_override_cents"), // null = use snapshot
    // Branded microsite.
    proposal_slug: text("proposal_slug").notNull().unique(),
    view_count: integer("view_count").notNull().default(0),
    last_viewed_at: timestamp("last_viewed_at", { withTimezone: true }),
    ...timestamps,
  }
);

// One row per microsite open (mirrors proposal_view). Feeds the buyer's
// "your prospect opened the quote" signal + view_count.
export const prospectView = pgTable("prospect_view", {
  id: uuid("id").primaryKey().defaultRandom(),
  prospect_id: uuid("prospect_id")
    .notNull()
    .references(() => prospect.id, { onDelete: "cascade" }),
  user_agent: text("user_agent"),
  viewed_at: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- outreach campaigns (operator review workflow) --------------------------
// A campaign moves through operator approval GATES before anything sends:
//   properties -> recipients -> messaging -> ready -> sent
// Each gate is a human sign-off today; `auto_advance` is the seam for eventual
// full automation (cron creates a campaign and walks it through untouched).
// The runner still NEVER sends until the campaign reaches "ready" and execute
// is invoked (build spec §9 — no send without approval).

export const outreachCampaign = pgTable("outreach_campaign", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  // properties | recipients | messaging | ready | sent | canceled
  stage: text("stage").notNull().default("properties"),
  // snapshot of the selected open leads (property ids) approved at gate 1
  property_ids: jsonb("property_ids").$type<string[]>().default([]),
  price_cents: integer("price_cents").notNull().default(7900),
  exclusive_price_cents: integer("exclusive_price_cents").notNull().default(19900),
  auto_advance: boolean("auto_advance").notNull().default(false),
  sent_at: timestamp("sent_at"),
  ...timestamps,
});

// One row per company in a campaign. Carries the matched lead, the resolved
// send channel, and the (editable) message — so gate 2 reviews the list and
// gate 3 reviews/edits copy, all persisted.
export const outreachRecipient = pgTable("outreach_recipient", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaign_id: uuid("campaign_id")
    .notNull()
    .references(() => outreachCampaign.id, { onDelete: "cascade" }),
  company_name: text("company_name").notNull(),
  email: text("email"),
  website: text("website"),
  contact_form_url: text("contact_form_url"),
  city: text("city"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  property_id: uuid("property_id").references(() => property.id),
  distance_mi: doublePrecision("distance_mi"),
  subject: text("subject"),
  body: text("body"),
  claim_token: text("claim_token"),
  included: boolean("included").notNull().default(true), // operator kept them at gate 2
  // pending | sent | manual (no email — paste into their form) | failed | skipped
  status: text("status").notNull().default("pending"),
  sent_at: timestamp("sent_at"),
  ...timestamps,
});

// --- chat (buyer <-> operator messaging) ------------------------------------
// One thread per buyer. Anonymous homepage chats find-or-create the buyer row
// by email but NEVER mint a session (account-takeover guard) — those get
// replies by email. Operator replies from /messages.

export const chatMessage = pgTable("chat_message", {
  id: uuid("id").primaryKey().defaultRandom(),
  buyer_id: uuid("buyer_id")
    .notNull()
    .references(() => buyer.id),
  sender: text("sender").notNull(), // buyer | operator
  body: text("body").notNull(),
  read_at: timestamp("read_at"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- usage counters (rate limiting + tenant metering) ----------------------
// Fixed-window counters, serverless-friendly (one upsert per check, no Redis).
// key examples: "quote:ip:1.2.3.4", "tenant:<uuid>:quotes". Old windows are
// pruned opportunistically by the pipeline runner.
export const usageCounter = pgTable(
  "usage_counter",
  {
    key: text("key").notNull(),
    window_start: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.window_start] })]
);

// Convenience type exports for the app layer.
export type Company = typeof company.$inferSelect;
export type PricingConfigRow = typeof pricingConfig.$inferSelect;
export type Property = typeof property.$inferSelect;
export type Measurement = typeof measurement.$inferSelect;
export type PricingResultRow = typeof pricingResult.$inferSelect;
export type Contact = typeof contact.$inferSelect;
export type Proposal = typeof proposal.$inferSelect;
export type Outreach = typeof outreach.$inferSelect;
export type Suppression = typeof suppression.$inferSelect;
export type Postcard = typeof postcard.$inferSelect;
export type Prospect = typeof prospect.$inferSelect;
export type ProspectView = typeof prospectView.$inferSelect;
