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
} from "drizzle-orm/pg-core";

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
  "other",
]);

export const propertySourceEnum = pgEnum("property_source", ["manual", "places"]);

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
]);

export const outreachStatusEnum = pgEnum("outreach_status", [
  "draft",
  "approved",
  "sent",
  "replied",
  "bounced",
  "unsubscribed",
]);

// --- company -------------------------------------------------------------

export const company = pgTable("company", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
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
  ...timestamps,
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
