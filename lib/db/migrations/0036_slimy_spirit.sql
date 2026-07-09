ALTER TABLE "lead_unlock" ADD COLUMN "cycle" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "property" ADD COLUMN "sale_cycle" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "property" ADD COLUMN "renewed_at" timestamp with time zone;