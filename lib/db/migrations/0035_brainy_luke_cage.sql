ALTER TYPE "public"."buyer_outreach_status" ADD VALUE 'bounced';--> statement-breakpoint
ALTER TABLE "buyer_outreach" ADD COLUMN "resend_message_id" text;--> statement-breakpoint
ALTER TABLE "buyer_outreach" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "buyer_outreach" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "buyer_outreach" ADD COLUMN "clicked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "buyer_outreach" ADD COLUMN "open_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "buyer_outreach" ADD COLUMN "click_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "buyer_outreach" ADD COLUMN "last_event" text;