CREATE TYPE "public"."activity_kind" AS ENUM('call', 'email_out', 'email_in', 'letter', 'meeting', 'note', 'stage_change', 'revisit_due', 'system');--> statement-breakpoint
CREATE TYPE "public"."custom_field_type" AS ENUM('number', 'text', 'enum', 'boolean', 'date');--> statement-breakpoint
CREATE TYPE "public"."entity_kind" AS ENUM('company', 'contact', 'deal');--> statement-breakpoint
CREATE TYPE "public"."stage_kind" AS ENUM('open', 'nurture', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'member', 'readonly');--> statement-breakpoint
CREATE TABLE "activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"deal_id" uuid,
	"brand_id" uuid,
	"kind" "activity_kind" NOT NULL,
	"subject" text,
	"body" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"external_id" text,
	"email_address" text,
	"delivered_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"complained_at" timestamp with time zone,
	"open_count" integer DEFAULT 0 NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"record_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"from_email" text,
	"reply_to_email" text,
	"postal_address" text,
	"website" text,
	"logo_url" text,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"website" text,
	"domain" text,
	"phone" text,
	"email" text,
	"address" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country" text,
	"brand_id" uuid,
	"owner_user_id" uuid,
	"source" text,
	"description" text,
	"revisit_date" date,
	"revisit_note" text,
	"revisit_user_id" uuid,
	"revisit_surfaced_at" timestamp with time zone,
	"blocked_at" timestamp with time zone,
	"blocked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"title" text,
	"email" text,
	"phone" text,
	"mobile" text,
	"linkedin_url" text,
	"priority_rank" integer,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notes" text,
	"revisit_date" date,
	"revisit_note" text,
	"revisit_user_id" uuid,
	"revisit_surfaced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "custom_field_def" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" "entity_kind" DEFAULT 'company' NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" "custom_field_type" NOT NULL,
	"options" jsonb,
	"help_text" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_def_entity_key_uniq" UNIQUE("entity","key")
);
--> statement-breakpoint
CREATE TABLE "custom_field_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"def_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"num_value" bigint,
	"text_value" text,
	"bool_value" boolean,
	"date_value" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_value_def_record_uniq" UNIQUE("def_id","record_id")
);
--> statement-breakpoint
CREATE TABLE "deal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"brand_id" uuid,
	"stage_id" uuid NOT NULL,
	"title" text NOT NULL,
	"value_cents" bigint,
	"currency" text DEFAULT 'USD' NOT NULL,
	"owner_user_id" uuid,
	"revisit_date" date,
	"revisit_note" text,
	"revisit_user_id" uuid,
	"revisit_surfaced_at" timestamp with time zone,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"file_name" text,
	"actor_user_id" uuid,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_created" integer DEFAULT 0 NOT NULL,
	"rows_updated" integer DEFAULT 0 NOT NULL,
	"rows_skipped" integer DEFAULT 0 NOT NULL,
	"errors" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"kind" "stage_kind" DEFAULT 'open' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_stage_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "suppression" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppression_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "usage_counter" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counter_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_actor_user_id_crm_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."crm_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_crm_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."crm_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_owner_user_id_crm_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."crm_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_revisit_user_id_crm_user_id_fk" FOREIGN KEY ("revisit_user_id") REFERENCES "public"."crm_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_revisit_user_id_crm_user_id_fk" FOREIGN KEY ("revisit_user_id") REFERENCES "public"."crm_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_def_id_custom_field_def_id_fk" FOREIGN KEY ("def_id") REFERENCES "public"."custom_field_def"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_owner_user_id_crm_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."crm_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_revisit_user_id_crm_user_id_fk" FOREIGN KEY ("revisit_user_id") REFERENCES "public"."crm_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_actor_user_id_crm_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."crm_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_company_time_idx" ON "activity" USING btree ("company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_external_idx" ON "activity" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "activity_deal_idx" ON "activity" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "audit_log_record_idx" ON "audit_log" USING btree ("entity","record_id","created_at");--> statement-breakpoint
CREATE INDEX "company_revisit_idx" ON "company" USING btree ("revisit_date") WHERE revisit_date is not null;--> statement-breakpoint
CREATE INDEX "company_brand_idx" ON "company" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "company_owner_idx" ON "company" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "company_domain_idx" ON "company" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "contact_company_idx" ON "contact" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "contact_revisit_idx" ON "contact" USING btree ("revisit_date") WHERE revisit_date is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_company_email_uniq" ON "contact" USING btree ("company_id","email") WHERE email is not null;--> statement-breakpoint
CREATE INDEX "custom_field_value_record_idx" ON "custom_field_value" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "deal_company_idx" ON "deal" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "deal_stage_idx" ON "deal" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "deal_revisit_idx" ON "deal" USING btree ("revisit_date") WHERE revisit_date is not null;--> statement-breakpoint
CREATE INDEX "pipeline_stage_order_idx" ON "pipeline_stage" USING btree ("sort_order");