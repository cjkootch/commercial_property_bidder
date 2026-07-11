ALTER TABLE "buyer_outreach" ADD COLUMN "nudge_message_id" text;--> statement-breakpoint
ALTER TABLE "buyer_outreach" ADD COLUMN "nudge_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "buyer_outreach" ADD COLUMN "nudge_clicked_at" timestamp with time zone;