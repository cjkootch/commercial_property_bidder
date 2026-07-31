-- Two data corrections, no schema change.

-- 1. Clear untrustworthy outbound sender attribution.
--
-- sms_send.our_number shipped with `data.from ?? c.from`, which is wrong
-- whenever a Messaging Service is in use: the create response usually returns
-- queued with no sender assigned, so every row was stamped with the configured
-- TWILIO_FROM instead of the pool number that actually sent it. The status
-- callback's coalesce() then saw a non-null value and never corrected it.
--
-- The lie was visible in the data: 288 outbound rows all claimed +18329242682
-- while 50 replies arrived on +18325983318 — a number the records said had
-- never sent anything.
--
-- We cannot recover the true sender for these rows (it lives in Twilio's logs),
-- and a wrong attribution is worse than a missing one because it invites
-- action. So: null every outbound value written while the bug was live. Inbound
-- is untouched — it reads params.To directly and has been correct throughout,
-- which is the half that matters for tracking a number hand-off.
UPDATE "sms_send"
SET "our_number" = NULL
WHERE "direction" = 'out'
  AND "our_number" IS NOT NULL;

--> statement-breakpoint

-- 2. Ledger the two numbers that still produce Twilio error 21211.
--
-- Twilio logged 3,122 of these in 30 days. A sweep of every stored phone
-- through the app's own toE164/isValidNanp shows only TWO survive validation
-- and are structurally impossible — so the flood was these two retried roughly
-- 1,500 times each, not a broad data-quality problem.
--
-- Area codes 533 and 428 are unassigned in the NANP, so unlike the pattern
-- heuristics considered earlier there is no false-positive risk here: these are
-- named numbers verified individually, not a regex over live data.
--
-- fail_count seeded at 0 because these hits were never recorded locally; the
-- counter should reflect what this ledger has actually observed.
INSERT INTO "sms_undeliverable" ("phone", "error_code", "reason", "fail_count")
VALUES
  ('+15333333333', '21211', 'unassigned area code 533 — parsing artifact, rejected by Twilio', 0),
  ('+14285714285', '21211', 'unassigned area code 428 — parsing artifact (1/0.35), rejected by Twilio', 0)
ON CONFLICT ("phone") DO NOTHING;
