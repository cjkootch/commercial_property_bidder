CREATE TABLE "short_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"target_url" text NOT NULL,
	"expires_at" timestamp with time zone,
	"click_count" integer DEFAULT 0 NOT NULL,
	"last_clicked_at" timestamp with time zone,
	"source" text DEFAULT 'sms' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "short_link_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE INDEX "short_link_created_idx" ON "short_link" USING btree ("created_at");