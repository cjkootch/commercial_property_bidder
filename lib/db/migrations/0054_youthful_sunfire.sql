CREATE TABLE "pending_sms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"body" text NOT NULL,
	"kind" text DEFAULT 'ai_reply' NOT NULL,
	"company_key" text,
	"ref_id" text,
	"tz" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "pending_sms_phone_unique" UNIQUE("phone")
);
