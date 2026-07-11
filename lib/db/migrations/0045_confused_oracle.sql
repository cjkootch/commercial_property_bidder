CREATE TABLE "sms_opt_out" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_opt_out_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "sms_send" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction" text DEFAULT 'out' NOT NULL,
	"kind" text NOT NULL,
	"company_key" text,
	"buyer_id" uuid,
	"ref_id" text,
	"phone" text NOT NULL,
	"body" text NOT NULL,
	"twilio_sid" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"error_code" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sms_send" ADD CONSTRAINT "sms_send_buyer_id_buyer_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyer"("id") ON DELETE set null ON UPDATE no action;