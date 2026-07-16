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
  uniqueIndex,
  index,
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
  // Cached ATTOM expanded-profile facts (lib/integrations/attom.ts AttomFacts):
  // assessor owner + mailing, assessed/market value, building size, last sale.
  // Fetched at most ONCE per property, ever — the metered trial budget makes
  // cache-forever the whole design. fetched_at set even on an API miss so a
  // no-data address never costs a second call.
  attom: jsonb("attom"),
  attom_fetched_at: timestamp("attom_fetched_at", { withTimezone: true }),
  // Operator-set buying signal: the property is actively marketed for lease / has
  // a new property manager (spotted via a sign or listing). No reliable free API
  // for this, so it's a manual flag.
  actively_leasing: boolean("actively_leasing").notNull().default(false),
  // Soft archive: reviewed/used-for-modelling properties the operator wants out
  // of the working lists. Hidden from the dashboard pipeline and the buyer
  // marketplace, but measurements stay — the ML training export is unaffected.
  archived_at: timestamp("archived_at", { withTimezone: true }),
  // Lead marketplace: stamped when this property is exported as a sellable lead
  // (sold once — exported leads are excluded from future packages). Sold leads
  // carry PUBLIC-RECORD data only; see lib/leads/package.ts.
  lead_exported_at: timestamp("lead_exported_at"),
  // Current sale cycle (renewal annuity): commercial contracts re-bid
  // annually, so ~11 months after a lead sells, the renewal cron bumps this,
  // clears lead_exported_at, and the lead re-sells with fresh per-trade caps.
  // Unlocks record the cycle they were bought in (lead_unlock.cycle).
  sale_cycle: integer("sale_cycle").notNull().default(0),
  // When the renewal cron last reopened this lead (guards double-renewals).
  renewed_at: timestamp("renewed_at", { withTimezone: true }),
  // Marketplace teaser snapshot ({annual_lo, annual_hi, turf_sqft, projected,
  // computed_at}) — sized ONCE at sourcing so dashboard cards can show the
  // contract value without spending imagery quota per view.
  lead_teaser: jsonb("lead_teaser"),
  lead_buyer: text("lead_buyer"),
  // Waterfall offer blast: when the operator emailed this lead to nearby
  // buyers, and to how many — prevents accidental double-blasts.
  offer_sent_at: timestamp("offer_sent_at", { withTimezone: true }),
  offer_sent_count: integer("offer_sent_count"),
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

// --- buyer_outreach --------------------------------------------------------
// Automated buyer prospecting: outside landscaping companies (no account yet)
// we offered a specific lead to, with the qualification snapshot (office
// distance, commercial signal, found email) and send state. Apollo-discovered
// data here is for OUR OWN outreach targeting only — it never ships in a sold
// lead. One row per company per campaign; company_key drives the cooldown.

export const buyerOutreachStatusEnum = pgEnum("buyer_outreach_status", [
  "queued",
  "sent",
  "skipped",
  "bounced",
]);

export const buyerOutreach = pgTable("buyer_outreach", {
  id: uuid("id").primaryKey().defaultRandom(),
  // The lead offered; a deleted property keeps the outreach record for cooldowns.
  property_id: uuid("property_id").references(() => property.id, { onDelete: "set null" }),
  company_key: text("company_key").notNull(), // normalized name — dedupe/cooldown key
  company_name: text("company_name").notNull(),
  website: text("website"),
  email: text("email"),
  phone: text("phone"),
  contact_form_url: text("contact_form_url"),
  office_city: text("office_city"),
  office_lat: doublePrecision("office_lat"),
  office_lng: doublePrecision("office_lng"),
  distance_mi: doublePrecision("distance_mi"),
  // Homepage mentions commercial/HOA/property-management work.
  commercial_signal: boolean("commercial_signal"),
  claim_url: text("claim_url"),
  message: text("message"),
  status: buyerOutreachStatusEnum("status").notNull().default("queued"),
  sent_at: timestamp("sent_at", { withTimezone: true }),
  // Resend webhook tracking (email.delivered/opened/clicked/bounced/complained),
  // matched by message id — powers the campaign funnel on /campaigns.
  resend_message_id: text("resend_message_id"),
  delivered_at: timestamp("delivered_at", { withTimezone: true }),
  opened_at: timestamp("opened_at", { withTimezone: true }),
  clicked_at: timestamp("clicked_at", { withTimezone: true }),
  open_count: integer("open_count").notNull().default(0),
  click_count: integer("click_count").notNull().default(0),
  last_event: text("last_event"),
  // One follow-up max: set when the 48h engaged-but-unclaimed nudge goes out.
  nudged_at: timestamp("nudged_at", { withTimezone: true }),
  // Sequence-step attribution (CRM style): the nudge is a STEP on this same
  // thread, tracked by its own message id so the webhook can attribute the
  // step's opens/clicks. open_count/click_count stay thread-level totals;
  // these timestamps answer "did the FOLLOW-UP move them?".
  nudge_message_id: text("nudge_message_id"),
  nudge_opened_at: timestamp("nudge_opened_at", { withTimezone: true }),
  nudge_clicked_at: timestamp("nudge_clicked_at", { withTimezone: true }),
  ...timestamps,
},
(t) => [
  // At most ONE offer row per company per lead — the DB-level guard against
  // concurrent runs (cron + manual) emailing the same company twice. Partial:
  // operator direct replies (property_id NULL) are unlimited.
  uniqueIndex("buyer_outreach_property_company_uniq")
    .on(t.property_id, t.company_key)
    .where(sql`property_id is not null`),
]);

// --- prospect_company ------------------------------------------------------
// One profile per company we've ever pitched (keyed by normalized name),
// enriched as they act. Email-funnel aggregates (sends/opens/clicks) are
// computed on read from buyer_outreach to avoid dual-write drift; this row
// stores identity plus the events that have no other home: claim-page views
// (the hottest unconverted signal — they read the offer) and the account
// linkage once they sign up.

export const prospectCompany = pgTable("prospect_company", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(), // companyKey(name)
  name: text("name").notNull(),
  trade: text("trade").notNull().default("landscaping"),
  website: text("website"),
  email: text("email"),
  phone: text("phone"),
  contact_form_url: text("contact_form_url"),
  office_city: text("office_city"),
  office_lat: doublePrecision("office_lat"),
  office_lng: doublePrecision("office_lng"),
  commercial_signal: boolean("commercial_signal"),
  // Twilio Lookup v2 line_type_intelligence verdict for `phone`, cached so we
  // pay the lookup once per number: "mobile" | "voip" | "landline" |
  // "unknown" (+ carrier-unmapped types stored verbatim). We text mobile and
  // VoIP, skip landlines + toll-free business lines (2026-07-13). NULL =
  // never screened.
  line_type: text("line_type"),
  line_type_checked_at: timestamp("line_type_checked_at", { withTimezone: true }),
  // Set when the bounce-recovery job has tried to find a better number for a
  // phone that carrier-rejected an SMS (failed/undelivered). Attempt-once
  // marker so a company with no recoverable mobile isn't re-processed every
  // run; a successful swap resets line_type to NULL for a fresh JIT screen.
  phone_recovery_at: timestamp("phone_recovery_at", { withTimezone: true }),
  // Set when the opener queue has tried an Apollo mobile reveal to lead with
  // the owner's cell (cell-first is stronger for SMS). Attempt-once so we pay
  // the reveal credit at most once per company; a found cell overwrites phone
  // and resets line_type to NULL for a fresh JIT screen.
  cell_lookup_at: timestamp("cell_lookup_at", { withTimezone: true }),
  claim_views: integer("claim_views").notNull().default(0),
  last_claim_view_at: timestamp("last_claim_view_at", { withTimezone: true }),
  // Set when a signup arrives via a claim token carrying this company name.
  buyer_id: uuid("buyer_id").references(() => buyer.id, { onDelete: "set null" }),
  // Operator verdict: wrong vertical / junk record — the qualifier skips it
  // in EVERY future campaign (per-run ?exclude= was groundhog-day pruning).
  blocked_at: timestamp("blocked_at", { withTimezone: true }),
  blocked_reason: text("blocked_reason"),
  ...timestamps,
});

// --- bid_request -----------------------------------------------------------
// The other side of the marketplace: a property owner/manager asking for
// competing bids. v1 is capture + operator routing (the buyer roster is the
// supply); matching automation comes later. Public form, rate-limited.

export const bidRequest = pgTable("bid_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  address: text("address").notNull(),
  city: text("city"),
  // Which trade they need (lib/leads/trades registry key).
  trade: text("trade").notNull().default("landscaping"),
  notes: text("notes"),
  status: text("status").notNull().default("new"), // new | routed | closed
  ...timestamps,
});

// --- sourcing_reject -------------------------------------------------------
// Candidates a feed screened and rejected (low grass, wrong parcel class,
// dead imagery). Persisting them keeps weekly runs from re-buying the same
// rejections — at higher caps the attempt budget must reach FRESH candidates,
// and re-screens burn imagery spend. Key = "<feed>:<stable ref>".

export const sourcingReject = pgTable("sourcing_reject", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  reason: text("reason"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- email_send --------------------------------------------------------------
// The central send log for one-off emails (publish alerts, cart nudges, and
// any future path): sendEmail({logAs}) inserts a row and stores the Resend
// message id, so the engagement webhook can attribute opens/clicks. Exists
// because two shipped paths were flying blind — the rule is now "if it sends,
// it logs" (docs/instrumentation.md). Campaign sends keep their richer
// domain tables (buyer_outreach/outreach); this is for everything else.

export const emailSend = pgTable("email_send", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** out | in — inbound replies land here too (the email twin of sms_send), so
   *  ALL communication lives in one queryable place, not just the alert inbox. */
  direction: text("direction").notNull().default("out"),
  /** "res_publish_alert" | "cart_nudge" | "inbound_reply" | ... — the path. */
  kind: text("kind").notNull(),
  buyer_id: uuid("buyer_id").references(() => buyer.id, { onDelete: "set null" }),
  /** prospect_company.key — joins email onto the company journey (like SMS). */
  company_key: text("company_key"),
  /** What it was about (package id, property id) — attribution joins. */
  ref_id: text("ref_id"),
  to_email: text("to_email").notNull(),
  /** Sender; meaningful for inbound (the prospect who replied). */
  from_email: text("from_email"),
  subject: text("subject"),
  /** Reply text for inbound (outbound bodies are backfillable later). */
  body: text("body"),
  /** Inbound only: SES SPF+DKIM both PASS (guards against spoofed replies). */
  verified: boolean("verified"),
  resend_message_id: text("resend_message_id"),
  delivered_at: timestamp("delivered_at", { withTimezone: true }),
  opened_at: timestamp("opened_at", { withTimezone: true }),
  clicked_at: timestamp("clicked_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- sms_send ----------------------------------------------------------------
// The SMS twin of email_send — every Twilio message (out OR in) gets a row
// (the instrumentation rule: if it sends, it logs). Status callbacks update
// delivery state by twilio_sid; inbound replies land here too (direction
// "in") so the company profile shows the whole thread.

export const smsSend = pgTable("sms_send", {
  id: uuid("id").primaryKey().defaultRandom(),
  direction: text("direction").notNull().default("out"), // out | in
  /** "company_sms" | "inbound" | future kinds — the path that sent it. */
  kind: text("kind").notNull(),
  /** prospect_company.key — joins SMS onto the company journey. */
  company_key: text("company_key"),
  buyer_id: uuid("buyer_id").references(() => buyer.id, { onDelete: "set null" }),
  ref_id: text("ref_id"),
  /** The counterparty's number, E.164 (their phone for both directions). */
  phone: text("phone").notNull(),
  body: text("body").notNull(),
  twilio_sid: text("twilio_sid"),
  // queued | sent | delivered | undelivered | failed | received
  status: text("status").notNull().default("queued"),
  error_code: text("error_code"),
  delivered_at: timestamp("delivered_at", { withTimezone: true }),
  // Operator has seen this inbound reply in the SMS inbox. Only meaningful for
  // direction "in"; drives the iPhone-style unread dot in the thread list.
  read_at: timestamp("read_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// SMS opt-outs (STOP replies + manual). Checked before EVERY outbound SMS —
// Twilio blocks STOP'd numbers at the carrier level too, but we keep our own
// ledger so the UI can say "opted out" instead of silently failing.
export const smsOptOut = pgTable("sms_opt_out", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").notNull().unique(), // E.164
  reason: text("reason"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- pending_sms ---------------------------------------------------------
// TCPA quiet-hours defer queue. An inbound at 11pm can't get an 11pm marketing
// auto-reply (8am–9pm recipient-local rule), but the warm hand-raiser must not
// be dropped either — so the drafted reply is parked here and the sms-flush cron
// sends it the moment the recipient's window opens. Unique on phone: a fresh
// overnight draft REPLACES the parked one (no double-send in the morning). `tz`
// is the recipient's market timezone so the flush can gate per-recipient
// without DST math. sent_at stamps the send (kept for audit, not deleted).
export const pendingSms = pgTable("pending_sms", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").notNull().unique(), // E.164 recipient
  body: text("body").notNull(),
  kind: text("kind").notNull().default("ai_reply"),
  company_key: text("company_key"),
  ref_id: text("ref_id"),
  tz: text("tz").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sent_at: timestamp("sent_at", { withTimezone: true }),
});

// --- claim_event ---------------------------------------------------------
// Claim-page conversion funnel. We know page views (claim_views) and unlocks
// (lead_unlock), but not the CRUCIAL middle: what offer state a clicker was
// SHOWN, and whether they submitted the profile form. Without it, "clicks don't
// convert" is unattributable — 2026-07-13 showed two clicks fail two different
// ways (one arrived to a gone-free spot, one abandoned a valid free form). Each
// row is one funnel step; query by day to see where clicks die at real volume.
export const claimEvent = pgTable(
  "claim_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** prospect_company name we pitched (from the claim token). */
    company: text("company"),
    property_id: uuid("property_id"),
    trade: text("trade"),
    /** view_claimable | view_paid | view_filled | view_unsellable | view_expired
     *  | submit | submit_unlocked | submit_offer */
    event: text("event").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("claim_event_created_idx").on(t.created_at)]
);

// --- lead_hold -----------------------------------------------------------
// Loss-aversion reservation (Godin, "This Is Marketing"): when a pitched
// company opens their claim link, the single free spot on that lead+trade is
// HELD for them for 24h. Others see it as taken; if they don't claim in time it
// releases to the next company. This makes "held for you, or it goes to someone
// else" literally true instead of a manufactured urgency. One free spot per
// lead+trade (FREE_MAX_PER_LEAD = 1), so the hold is unique on (property, trade)
// — first opener wins it. Expiry is lazy: a row with expires_at in the past is
// simply not "live". company is the prospect_company key (holders aren't buyers
// yet at pitch time).
export const leadHold = pgTable(
  "lead_hold",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    property_id: uuid("property_id").notNull(),
    trade: text("trade").notNull(),
    company: text("company").notNull(), // companyKey() of the pitched company
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One free spot per lead+trade → one holder. First opener wins via
    // onConflictDoNothing; expired rows are cleared before a fresh insert.
    unique("lead_hold_slot_uq").on(t.property_id, t.trade),
  ]
);

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
  // Which trade this company buys leads for (lib/leads/trades registry).
  // The scarcity cap, exclusivity, ranking, and shelf relevance are ALL
  // scoped per trade — trades don't compete for the same spots.
  trade: text("trade").notNull().default("landscaping"),
  email: text("email").notNull().unique(),
  city: text("city"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  notify: boolean("notify").notNull().default(true),
  // Operator kill switch for a bad actor (chargeback abuser, scraper). Set =
  // the session resolves to null in currentBuyerId() and new logins are
  // refused, so revoking access no longer depends on rotating the stateless
  // session secret. Suppression only stops emails; this stops the portal.
  banned_at: timestamp("banned_at", { withTimezone: true }),
  banned_reason: text("banned_reason"),
  // First Look subscription (MRR): members see brand-new leads during the
  // early-access window before they hit the public shelf. plan flips via the
  // Stripe webhook (subscription checkout / invoice.paid / cancellation);
  // plan_expires_at makes lapses safe even if a webhook is missed.
  plan: text("plan").notNull().default("free"), // free | first_look
  plan_expires_at: timestamp("plan_expires_at", { withTimezone: true }),
  stripe_subscription_id: text("stripe_subscription_id"),
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
  // Dashboard alert feed: events newer than this are "unread" (badge + dot).
  alerts_seen_at: timestamp("alerts_seen_at", { withTimezone: true }),
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
    // Sale cycle this unlock belongs to (matches property.sale_cycle at
    // unlock time). Contracts re-bid annually: the renewal cron bumps the
    // property's cycle, giving each anniversary a FRESH per-trade cap while
    // history stays intact. Exclusives close their trade across ALL cycles.
    cycle: integer("cycle").notNull().default(0),
    // Denormalized from buyer.trade at unlock time: the 3-spot cap, the
    // exclusive, and the per-lead free budget all count WITHIN a trade.
    trade: text("trade").notNull().default("landscaping"),
    price_cents: integer("price_cents").notNull().default(0),
    stripe_session_id: text("stripe_session_id"),
    dossier: jsonb("dossier"),
    // Outreach pipeline the buyer drives on each lead — turns Greenkeep into
    // their CRM (stickiness) and gives us win/loss signal for pricing.
    // new | letter_sent | postcard_sent | contacted | bidding | won | lost
    outreach_status: text("outreach_status").notNull().default("new"),
    ...timestamps,
  },
  // Uniqueness is per TRADE per CYCLE, matching the scarcity model: a renewal
  // (new cycle) reopens the lead, so the incumbent buyer who worked it last
  // year MUST be able to buy its renewal — the old (property_id, buyer_id)
  // constraint silently no-op'd that repurchase (settled money, no unlock row).
  // Intra-cycle double-claims are still blocked (same property+buyer+trade+
  // cycle), which is what the free-claim paths rely on.
  (t) => [
    unique("lead_unlock_property_buyer_trade_cycle").on(t.property_id, t.buyer_id, t.trade, t.cycle),
    // property_id is covered by the composite unique's leading column; buyer_id
    // (the buyer's "my unlocks" list) is not, so index it explicitly.
    index("lead_unlock_buyer_idx").on(t.buyer_id),
  ]
);

// Append-only activity log per unlocked lead: status changes, notes, and
// postcard mailings. Powers the timeline on the sheet.
export const leadActivity = pgTable(
  "lead_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unlock_id: uuid("unlock_id")
      .notNull()
      .references(() => leadUnlock.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // status | note | postcard
    detail: text("detail").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Timeline is always queried by unlock_id — index the FK.
  (t) => [index("lead_activity_unlock_idx").on(t.unlock_id)]
);

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
// --- residential (Jules foundation, regenerated on current main) --------
export const mailProviderEnum = pgEnum("mail_provider", ["lob", "manual"]);

export const mailFormatEnum = pgEnum("mail_format", [
  "postcard_6x9",
  "postcard_6x11",
  "letter",
]);

export const mailCampaignStatusEnum = pgEnum("mail_campaign_status", [
  "draft",
  "proof_ready",
  "approved",
  "lob_test_ready",
  "submitted",
  "in_production",
  "mailed",
  "completed",
  "failed",
  "cancelled",
]);

export const mailRecipientStatusEnum = pgEnum("mail_recipient_status", [
  "pending",
  "validated",
  "invalid_address",
  "test_submitted",
  "submitted",
  "mailed",
  "failed",
]);

export const residentialSignalTypeEnum = pgEnum("residential_signal_type", [
  "recently_sold",
  "new_construction",
  "permit_completed",
  "certificate_of_occupancy",
  "newly_listed",
  "stale_listing",
  "price_reduction",
  "withdrawn_listing",
  "subdivision_phase",
  "manual",
]);

export const residentialSourceEnum = pgEnum("residential_source", [
  "manual",
  "public_permit",
  "public_deed",
  "builder_site",
  "partner_feed",
  "import_csv",
]);

export const residentialLeadStatusEnum = pgEnum("residential_lead_status", [
  "sourced",
  "qualified",
  "packaged",
  "unlocked",
  "archived",
]);

export const residentialPackageStatusEnum = pgEnum("residential_package_status", [
  "draft",
  "published",
  "sold_out",
  "archived",
]);


// --- residential_lead ----------------------------------------------------

export const residentialLead = pgTable("residential_lead", {
  id: uuid("id").primaryKey().defaultRandom(),
  company_id: uuid("company_id")
    .notNull()
    .references(() => company.id),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  subdivision_name: text("subdivision_name"),
  builder_name: text("builder_name"),
  signal_type: residentialSignalTypeEnum("signal_type").notNull(),
  signal_date: timestamp("signal_date", { withTimezone: true }),
  source: residentialSourceEnum("source").notNull().default("manual"),
  estimated_home_value: integer("estimated_home_value"),
  lot_size_sqft: doublePrecision("lot_size_sqft"),
  year_built: integer("year_built"),
  confidence: confidenceEnum("confidence").notNull().default("Med"),
  status: residentialLeadStatusEnum("status").notNull().default("sourced"),
  notes: text("notes"),
  raw_source: jsonb("raw_source"),
  ...timestamps,
});

// --- residential_package -------------------------------------------------

export const residentialPackage = pgTable("residential_package", {
  id: uuid("id").primaryKey().defaultRandom(),
  company_id: uuid("company_id")
    .notNull()
    .references(() => company.id),
  name: text("name").notNull(),
  geography_label: text("geography_label"),
  zip: text("zip"),
  lead_count: integer("lead_count").notNull().default(0),
  signal_summary: jsonb("signal_summary"),
  exclusive_until: timestamp("exclusive_until", { withTimezone: true }),
  price_cents: integer("price_cents").notNull().default(0),
  status: residentialPackageStatusEnum("status").notNull().default("draft"),
  ...timestamps,
});

// --- residential_package_membership --------------------------------------

export const residentialPackageMembership = pgTable(
  "residential_package_membership",
  {
    package_id: uuid("package_id")
      .notNull()
      .references(() => residentialPackage.id),
    residential_lead_id: uuid("residential_lead_id")
      .notNull()
      .references(() => residentialLead.id),
  },
  (t) => [primaryKey({ columns: [t.package_id, t.residential_lead_id] })]
);

// --- residential_unlock --------------------------------------------------

export const residentialUnlock = pgTable(
  "residential_unlock",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buyer_id: uuid("buyer_id")
      .notNull()
      .references(() => buyer.id),
    residential_package_id: uuid("residential_package_id")
      .notNull()
      .references(() => residentialPackage.id),
    kind: text("kind").notNull().default("paid"), // free | paid | exclusive
    price_cents: integer("price_cents").notNull().default(0),
    stripe_session_id: text("stripe_session_id"),
    dossier: jsonb("dossier"),
    ...timestamps,
  },
  (t) => [unique("residential_unlock_buyer_package").on(t.buyer_id, t.residential_package_id)]
);

export type ResidentialLead = typeof residentialLead.$inferSelect;
export type ResidentialPackage = typeof residentialPackage.$inferSelect;
export type ResidentialPackageMembership = typeof residentialPackageMembership.$inferSelect;
export type ResidentialUnlock = typeof residentialUnlock.$inferSelect;
export const residentialMailCampaign = pgTable("residential_mail_campaign", {
  id: uuid("id").primaryKey().defaultRandom(),
  company_id: uuid("company_id")
    .notNull()
    .references(() => company.id),
  buyer_id: uuid("buyer_id").references(() => buyer.id),
  residential_package_id: uuid("residential_package_id")
    .notNull()
    .references(() => residentialPackage.id),
  provider: mailProviderEnum("provider").notNull().default("lob"),
  mail_format: mailFormatEnum("mail_format").notNull(),
  status: mailCampaignStatusEnum("status").notNull().default("draft"),
  name: text("name").notNull(),
  offer_headline: text("offer_headline"),
  proof_front_html: text("proof_front_html"),
  proof_back_html: text("proof_back_html"),
  proof_front_copy: text("proof_front_copy"),
  proof_back_copy: text("proof_back_copy"),
  mailpiece_count: integer("mailpiece_count").notNull().default(0),
  estimated_print_postage_cost_cents: integer("estimated_print_postage_cost_cents"),
  client_price_cents: integer("client_price_cents"),
  lob_campaign_id: text("lob_campaign_id"),
  lob_metadata: jsonb("lob_metadata"),
  tracking_summary: jsonb("tracking_summary"),
  approved_at: timestamp("approved_at", { withTimezone: true }),
  submitted_at: timestamp("submitted_at", { withTimezone: true }),
  mailed_at: timestamp("mailed_at", { withTimezone: true }),
  ...timestamps,
});

export const residentialMailRecipient = pgTable(
  "residential_mail_recipient",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    residential_mail_campaign_id: uuid("residential_mail_campaign_id")
      .notNull()
      .references(() => residentialMailCampaign.id),
    residential_lead_id: uuid("residential_lead_id")
      .notNull()
      .references(() => residentialLead.id),
    address: text("address").notNull(),
    address_line2: text("address_line2"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    zip: text("zip").notNull(),
    recipient_name: text("recipient_name"),
    lob_address_id: text("lob_address_id"),
    lob_postcard_id: text("lob_postcard_id"),
    lob_letter_id: text("lob_letter_id"),
    status: mailRecipientStatusEnum("status").notNull().default("pending"),
    lob_status: text("lob_status"),
    mailed_at: timestamp("mailed_at", { withTimezone: true }),
    raw_lob_response: jsonb("raw_lob_response"),
    ...timestamps,
  },
  (t) => [
    unique("res_mail_campaign_lead").on(
      t.residential_mail_campaign_id,
      t.residential_lead_id
    ),
  ]
);


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
