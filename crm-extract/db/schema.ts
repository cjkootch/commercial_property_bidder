// CRM schema for M&A origination.
//
// This is NOT a copy of the source app's schema (36 tables of landscaping
// properties, turf measurements, parcel geometry, postcards). It is the CRM
// spine, rebuilt around the eight required behaviours, reusing the source's
// structural habits that proved out in production:
//
//   - a `dedupe_key` text column + UNIQUE for idempotent upsert (source:
//     prospect_company.key)
//   - append-only activity rows keyed by the parent record, FK-indexed
//     (source: lead_activity + email_send + sms_send)
//   - partial unique indexes as the concurrency arbiter, because the Neon HTTP
//     driver has no transactions (source: buyer_outreach's two partial indexes)
//   - a (key, window_start) counter table doing double duty as rate limiter
//     AND once-ever idempotency marker (source: usage_counter)
//   - shared `timestamps` spread, touched by the app layer on write
//
// DATE vs TIMESTAMP: `revisit_date` is a DATE (not timestamptz) on purpose. A
// revisit is "surface this on this calendar day", and a timestamptz makes that
// question timezone-dependent — the source app hit this class of bug twice with
// day-bucketed counters. Drizzle returns DATE as a "YYYY-MM-DD" string, which
// compares correctly against a caller-supplied local today.

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  date,
  timestamp,
  jsonb,
  primaryKey,
  unique,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Reusable timestamp columns. `updated_at` must be set by the app layer on
 *  write — Drizzle has no portable ON UPDATE trigger. */
const timestamps = {
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// --- enums -----------------------------------------------------------------

/** What a pipeline stage MEANS, independent of its label. The firm can rename
 *  and reorder stages freely; the engine only needs to know which ones are
 *  live work, which is the long-fuse nurture pool, and which are terminal. */
export const stageKindEnum = pgEnum("stage_kind", ["open", "nurture", "won", "lost"]);

/** Timeline entry types. `letter` is first-class because origination runs on
 *  physical mail; `email_in`/`email_out` are separate so a thread reads
 *  correctly without inspecting a direction column. */
export const activityKindEnum = pgEnum("activity_kind", [
  "call",
  "email_out",
  "email_in",
  "letter",
  "meeting",
  "note",
  "stage_change",
  "revisit_due",
  "system",
]);

/** Custom-field value types. Typed columns (not a jsonb blob) so custom fields
 *  are filterable and sortable in SQL — the source app's jsonb-everything
 *  approach made its own enrichment data unqueryable. */
export const customFieldTypeEnum = pgEnum("custom_field_type", [
  "number",
  "text",
  "enum",
  "boolean",
  "date",
]);

export const entityKindEnum = pgEnum("entity_kind", ["company", "contact", "deal"]);

export const userRoleEnum = pgEnum("user_role", ["admin", "member", "readonly"]);

// --- brand -----------------------------------------------------------------
// Two-brand attribution: ONE backend, two outward-facing identities. Every
// record and every send is attributable to a brand. This replaces the source
// app's host-based tenant resolution (lib/tenant.ts), which keyed off a
// subdomain — here the brand is explicit data on the record, because a single
// operator works both brands from one inbox and one screen.

export const brand = pgTable("brand", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Stable code used in env/config and email routing, e.g. "acme_advisors". */
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  /** Sender identity for this brand: "Name <addr@brand-domain.com>". Keep the
   *  two brands on SEPARATE verified domains — a reputation hit on one must not
   *  land the other's mail in spam (the source app's transactional/campaign
   *  domain split, generalized). */
  from_email: text("from_email"),
  reply_to_email: text("reply_to_email"),
  /** Physical address for the CAN-SPAM footer on any bulk send. */
  postal_address: text("postal_address"),
  website: text("website"),
  logo_url: text("logo_url"),
  color: text("color"),
  ...timestamps,
});

// --- crm_user --------------------------------------------------------------
// Real per-person identity. The source app gated its whole operator area
// behind ONE shared secret (lib/auth.ts) with a TODO(clerk) that never
// happened; a firm with several bankers needs to know who logged the call.
// Auth itself stays passwordless (see auth/tokens.ts) — this table is the
// identity + ownership anchor, not a password store.

export const crmUser = pgTable("crm_user", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: userRoleEnum("role").notNull().default("member"),
  /** Null = active. Set to revoke access without deleting attribution. */
  disabled_at: timestamp("disabled_at", { withTimezone: true }),
  ...timestamps,
});

// --- company ---------------------------------------------------------------
// THE primary record. Contacts, deals, activity and custom values all hang off
// it. An origination target is a company first and a deal second — the company
// outlives every deal you ever open on it, which is exactly why revisit_date
// lives here too.

export const company = pgTable(
  "company",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Normalized identity for idempotent import (see crm/companies.ts
     *  companyKey()). UNIQUE — this column is what makes re-running an import
     *  safe. Source pattern: prospect_company.key. */
    dedupe_key: text("dedupe_key").notNull().unique(),
    name: text("name").notNull(),
    legal_name: text("legal_name"),
    website: text("website"),
    /** Registrable domain, derived from website/email. Second dedupe axis: the
     *  source app learned that name-only keys let one company in under two
     *  spellings and get contacted twice. */
    domain: text("domain"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    postal_code: text("postal_code"),
    country: text("country"),
    /** Which outward-facing brand owns the relationship. */
    brand_id: uuid("brand_id").references(() => brand.id, { onDelete: "set null" }),
    /** Banker responsible. */
    owner_user_id: uuid("owner_user_id").references(() => crmUser.id, { onDelete: "set null" }),
    /** Free-text provenance: "list:sic_3441_tx", "referral:jdoe", "inbound". */
    source: text("source"),
    description: text("description"),

    // --- revisit: the multi-year fuse ---------------------------------------
    // "Not right now" is the most common answer in origination and the most
    // valuable one to keep. A DATE, an owner, and the reason it was set.
    /** Calendar day this record should come back. NULL = not scheduled. */
    revisit_date: date("revisit_date"),
    /** Why — shown verbatim in the due list so the banker re-enters the
     *  conversation with context, not a bare company name. */
    revisit_note: text("revisit_note"),
    /** Whose queue it lands in. Falls back to owner_user_id when null. */
    revisit_user_id: uuid("revisit_user_id").references(() => crmUser.id, { onDelete: "set null" }),
    /** Set by the sweep when a due revisit has been surfaced, so the digest
     *  doesn't re-page daily while the item sits in the queue. Cleared
     *  whenever revisit_date changes. */
    revisit_surfaced_at: timestamp("revisit_surfaced_at", { withTimezone: true }),

    /** Operator verdict: never contact again (wrong target, hostile, acquired).
     *  Source pattern: prospect_company.blocked_at — a per-run exclusion list
     *  was "groundhog-day pruning"; the verdict has to persist. */
    blocked_at: timestamp("blocked_at", { withTimezone: true }),
    blocked_reason: text("blocked_reason"),
    ...timestamps,
  },
  (t) => [
    // The due-sweep and the due-list UI both scan this. Partial: the vast
    // majority of rows have no revisit scheduled.
    index("company_revisit_idx").on(t.revisit_date).where(sql`revisit_date is not null`),
    index("company_brand_idx").on(t.brand_id),
    index("company_owner_idx").on(t.owner_user_id),
    index("company_domain_idx").on(t.domain),
  ]
);

// --- contact ---------------------------------------------------------------
// Attached to a COMPANY (the source app's contact table was FK'd to a property,
// which is the single change that made it unusable here).

export const contact = pgTable(
  "contact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    company_id: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    full_name: text("full_name").notNull(),
    title: text("title"),
    email: text("email"),
    phone: text("phone"),
    mobile: text("mobile"),
    linkedin_url: text("linkedin_url"),
    /** Ranked decision-maker ordering within the company (1 = talk to first). */
    priority_rank: integer("priority_rank"),
    is_primary: boolean("is_primary").notNull().default(false),
    notes: text("notes"),
    /** A revisit can hang off a PERSON, not just the company — "call Dan after
     *  his Q3 close" is a contact-level fuse. */
    revisit_date: date("revisit_date"),
    revisit_note: text("revisit_note"),
    revisit_user_id: uuid("revisit_user_id").references(() => crmUser.id, { onDelete: "set null" }),
    revisit_surfaced_at: timestamp("revisit_surfaced_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("contact_company_idx").on(t.company_id),
    index("contact_revisit_idx").on(t.revisit_date).where(sql`revisit_date is not null`),
    // Idempotent contact import: one row per (company, email). Partial, so
    // multiple email-less contacts per company remain legal. Addresses are
    // lowercased by the writer (crm/companies.ts upsertContact) rather than by a
    // lower() expression index — a plain column target is what ON CONFLICT can
    // reference portably.
    uniqueIndex("contact_company_email_uniq")
      .on(t.company_id, t.email)
      .where(sql`email is not null`),
  ]
);

// --- pipeline_stage --------------------------------------------------------
// CUSTOM stages as DATA, not a pgEnum. The source app hardcoded a 10-value
// property_status enum plus a 7-value text status plus a proposal status —
// three parallel pipelines, none configurable, each needing a migration to
// add a step. Here the firm edits rows.

export const pipelineStage = pgTable(
  "pipeline_stage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    label: text("label").notNull(),
    /** Semantics the engine branches on; the label is cosmetic. Exactly one
     *  "nurture" stage is expected, and it is where revisit_date does its work:
     *  a deal parked in nurture with a revisit 18 months out is the core
     *  origination asset. */
    kind: stageKindEnum("kind").notNull().default("open"),
    sort_order: integer("sort_order").notNull().default(0),
    /** Where new deals land. */
    is_default: boolean("is_default").notNull().default(false),
    archived_at: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("pipeline_stage_order_idx").on(t.sort_order)]
);

// --- deal ------------------------------------------------------------------

export const deal = pgTable(
  "deal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    company_id: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    brand_id: uuid("brand_id").references(() => brand.id, { onDelete: "set null" }),
    stage_id: uuid("stage_id")
      .notNull()
      .references(() => pipelineStage.id),
    title: text("title").notNull(),
    /** Cents, bigint: enterprise values overflow int4 above ~$21M. The source
     *  app used integer cents for $29 packages — wrong scale for M&A. */
    value_cents: bigint("value_cents", { mode: "number" }),
    currency: text("currency").notNull().default("USD"),
    owner_user_id: uuid("owner_user_id").references(() => crmUser.id, { onDelete: "set null" }),
    /** Deal-level fuse, independent of the company's. */
    revisit_date: date("revisit_date"),
    revisit_note: text("revisit_note"),
    revisit_user_id: uuid("revisit_user_id").references(() => crmUser.id, { onDelete: "set null" }),
    revisit_surfaced_at: timestamp("revisit_surfaced_at", { withTimezone: true }),
    stage_changed_at: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    closed_at: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("deal_company_idx").on(t.company_id),
    index("deal_stage_idx").on(t.stage_id),
    index("deal_revisit_idx").on(t.revisit_date).where(sql`revisit_date is not null`),
  ]
);

// --- activity --------------------------------------------------------------
// THE timeline. Append-only, one table for every channel, always keyed to the
// company so a record page is one indexed query instead of a union of four.
//
// The source app split this across lead_activity + email_send + sms_send and
// then had to merge them in the page component; the merge was the bug surface.
// Email delivery state (Resend webhooks) lands on the same row that carries the
// message body, via external_id.

export const activity = pgTable(
  "activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    company_id: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    contact_id: uuid("contact_id").references(() => contact.id, { onDelete: "set null" }),
    deal_id: uuid("deal_id").references(() => deal.id, { onDelete: "set null" }),
    brand_id: uuid("brand_id").references(() => brand.id, { onDelete: "set null" }),
    kind: activityKindEnum("kind").notNull(),
    subject: text("subject"),
    body: text("body"),
    /** When it HAPPENED (a call logged tomorrow for yesterday sorts correctly).
     *  Distinct from created_at, which is when the row was written. */
    occurred_at: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    /** Who logged it. NULL = written by an automated path. */
    actor_user_id: uuid("actor_user_id").references(() => crmUser.id, { onDelete: "set null" }),
    /** Provider id for correlation — Resend message id for email, letter/vendor
     *  id for mail. Indexed: the webhook looks rows up by this. */
    external_id: text("external_id"),
    /** Counterparty address for email rows (to for out, from for in). */
    email_address: text("email_address"),
    delivered_at: timestamp("delivered_at", { withTimezone: true }),
    opened_at: timestamp("opened_at", { withTimezone: true }),
    clicked_at: timestamp("clicked_at", { withTimezone: true }),
    bounced_at: timestamp("bounced_at", { withTimezone: true }),
    complained_at: timestamp("complained_at", { withTimezone: true }),
    open_count: integer("open_count").notNull().default(0),
    click_count: integer("click_count").notNull().default(0),
    /** Anything channel-specific that doesn't deserve a column. */
    meta: jsonb("meta"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The record page: "this company's timeline, newest first".
    index("activity_company_time_idx").on(t.company_id, t.occurred_at),
    // The webhook's lookup path.
    index("activity_external_idx").on(t.external_id),
    index("activity_deal_idx").on(t.deal_id),
  ]
);

// --- custom fields ---------------------------------------------------------
// Definition + typed value. Two tables instead of a jsonb column so that
// "score > 7", "sector = manufacturing", and "owner_age_known = true" are all
// indexable SQL predicates.

export const customFieldDef = pgTable(
  "custom_field_def",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Which record type this field applies to. */
    entity: entityKindEnum("entity").notNull().default("company"),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: customFieldTypeEnum("type").notNull(),
    /** For type "enum": the allowed values, in display order. Validated in the
     *  app layer (crm/custom-fields.ts), not by a DB constraint, so the firm
     *  can add an option without a migration. */
    options: jsonb("options").$type<string[]>(),
    help_text: text("help_text"),
    sort_order: integer("sort_order").notNull().default(0),
    archived_at: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [unique("custom_field_def_entity_key_uniq").on(t.entity, t.key)]
);

export const customFieldValue = pgTable(
  "custom_field_value",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    def_id: uuid("def_id")
      .notNull()
      .references(() => customFieldDef.id, { onDelete: "cascade" }),
    /** The record this value is attached to. NOT a real FK: one value table
     *  serves companies, contacts and deals, so integrity is enforced by the
     *  writer (crm/custom-fields.ts) plus the def's `entity`. Documented
     *  trade-off — the alternative is three near-identical value tables. */
    record_id: uuid("record_id").notNull(),
    /** Exactly one of these is populated, per the def's type. */
    num_value: bigint("num_value", { mode: "number" }),
    text_value: text("text_value"),
    bool_value: boolean("bool_value"),
    date_value: date("date_value"),
    ...timestamps,
  },
  (t) => [
    // One value per field per record — makes setCustomFieldValue an upsert.
    unique("custom_field_value_def_record_uniq").on(t.def_id, t.record_id),
    index("custom_field_value_record_idx").on(t.record_id),
  ]
);

// --- suppression -----------------------------------------------------------
// Checked before every send. Reason matters: a marketing opt-out must not block
// a transactional message, and a hard bounce must block everything (see
// email/suppression.ts — the source app conflated these and locked paying
// customers out of buying again).

export const suppression = pgTable("suppression", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  reason: text("reason"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- usage_counter ---------------------------------------------------------
// Fixed-window counters, serverless-friendly (one upsert per check, no Redis).
// Does double duty:
//   - rate limiting: key "import:ip:1.2.3.4", window = current hour
//   - ONCE-EVER idempotency markers: key "revisit:<id>:<date>", window = a
//     far-future sentinel so the pruner never reclaims it
// This is how the source app got exactly-once semantics with no transactions.

export const usageCounter = pgTable(
  "usage_counter",
  {
    key: text("key").notNull(),
    window_start: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.window_start] })]
);

// --- audit_log -------------------------------------------------------------
// NEW — the source app had no audit trail at all (its closest analogue,
// claim_event, logged anonymous funnel steps). An advisory firm needs
// who-changed-what: stage moves, revisit edits, deletions.

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actor_user_id: uuid("actor_user_id").references(() => crmUser.id, { onDelete: "set null" }),
    /** "company.update" | "deal.stage_change" | "revisit.set" | "import.run" */
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    record_id: uuid("record_id"),
    /** Changed fields only, not whole rows. */
    before: jsonb("before"),
    after: jsonb("after"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_record_idx").on(t.entity, t.record_id, t.created_at)]
);

// --- import_batch ----------------------------------------------------------
// Provenance for bulk loads, so a re-run is auditable ("did the second run
// create anything, or was it a clean no-op?").

export const importBatch = pgTable("import_batch", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(),
  file_name: text("file_name"),
  actor_user_id: uuid("actor_user_id").references(() => crmUser.id, { onDelete: "set null" }),
  rows_total: integer("rows_total").notNull().default(0),
  rows_created: integer("rows_created").notNull().default(0),
  rows_updated: integer("rows_updated").notNull().default(0),
  rows_skipped: integer("rows_skipped").notNull().default(0),
  errors: jsonb("errors").$type<string[]>(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- inferred types --------------------------------------------------------

export type Brand = typeof brand.$inferSelect;
export type CrmUser = typeof crmUser.$inferSelect;
export type Company = typeof company.$inferSelect;
export type Contact = typeof contact.$inferSelect;
export type PipelineStage = typeof pipelineStage.$inferSelect;
export type Deal = typeof deal.$inferSelect;
export type Activity = typeof activity.$inferSelect;
export type CustomFieldDef = typeof customFieldDef.$inferSelect;
export type CustomFieldValue = typeof customFieldValue.$inferSelect;
export type AuditLog = typeof auditLog.$inferSelect;
export type ImportBatch = typeof importBatch.$inferSelect;
