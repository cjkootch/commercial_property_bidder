ALTER TABLE "outreach" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "clicked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "open_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "click_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "last_event" text;