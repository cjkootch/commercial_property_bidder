CREATE TABLE "sms_undeliverable" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"error_code" text,
	"reason" text,
	"fail_count" integer DEFAULT 1 NOT NULL,
	"first_failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_undeliverable_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
-- Backfill from failures we already recorded but never acted on. Without this
-- every known-dead number gets one more doomed send before the ledger catches
-- it. Groups by phone so the counter reflects real history, and takes the most
-- recent error code as the verdict.
INSERT INTO "sms_undeliverable" ("phone", "error_code", "reason", "fail_count", "first_failed_at", "last_failed_at")
SELECT
  s.phone,
  (ARRAY_AGG(s.error_code ORDER BY s.created_at DESC))[1] AS error_code,
  'backfilled from sms_send history' AS reason,
  COUNT(*)::int AS fail_count,
  MIN(s.created_at) AS first_failed_at,
  MAX(s.created_at) AS last_failed_at
FROM "sms_send" s
WHERE s.direction = 'out'
  AND s.error_code IN ('30005', '30006')
GROUP BY s.phone
ON CONFLICT ("phone") DO NOTHING;
