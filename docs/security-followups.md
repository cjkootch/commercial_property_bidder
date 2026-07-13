# Security follow-ups (from the Claude Fable audits)

Fixed-in-code items are in the PR history (#231 round 1; the round-2 code batch:
operator ban, inbound secret split, reply-alert defang + SPF/DKIM gate,
clientIp XFF comment). This file tracks what remains — the legal exposure and
the hardening that needs a human decision or a live smoke-test.

## Verified NON-issues (cleared by inspection)

- **Google Places ToS (audit #14) — N/A.** Grepped the codebase: no Google
  Places/Maps API is used. `maps.google.com/?q=` is a link builder;
  `fonts.googleapis.com` is a webfont. Dossier contact/business fields come
  from OSM, county records, and Apollo — none of which carry the Places resale
  restriction. Nothing to re-source.

## Legal — needs counsel BEFORE the relevant channel scales

- **TCPA on SMS (audit #13) — highest money risk.** Phone-only buyers get
  marketing SMS to numbers scraped from OSM/Places-style sources. Texts without
  prior express written consent carry $500–$1,500 per message in statutory
  damages (B2B included); plaintiffs' firms actively troll for this. Before
  scaling SMS: (a) consent capture at first touch, (b) a DNC scrub, (c) counsel
  review of the first-contact message. Code hooks that will be needed: a
  `consent_at` on the SMS recipient and a DNC suppression check in
  `lib/sms/queue.ts` alongside the existing opt-out ledger.
- **Data-broker registration (audit #15).** Selling packaged homeowner
  name/address lists sourced from records (not from the homeowner) meets the
  statutory definition of data brokerage in several states — Texas's 2023 law
  (registration + notice + security program) and California's Delete Act if any
  CA data is touched. Fines accrue per day unregistered. ~30 min with counsel
  before the residential side scales. The commercial B2B side is largely
  outside these regimes.

## Hardening — code, but needs a decision or a live test

- **SNS message-signature verification (audit #9, part 2).** The inbound-email
  route now uses a dedicated `INBOUND_WEBHOOK_SECRET` (no CRON_SECRET reuse) and
  defangs/marks unverified senders, but a leaked URL key still lets an attacker
  POST a forged "reply." The real fix is verifying the SNS message signature
  (SNS signs every delivery). Deferred because getting the canonical-string
  construction wrong would silently break the conversion-event alert, and it
  can't be validated in-sandbox — needs a live SES→SNS smoke test. Ship behind
  an `INBOUND_SNS_VERIFY` kill switch when built.
- **Operator session tokens / Clerk (round 1, #1 residual).** Operator auth now
  fails closed, but the cookie value is still the raw shared secret (one leak =
  master credential, no rotation/expiry). The real fix is the `TODO(clerk)`:
  signed session tokens or Clerk. Prioritize before the operator surface grows.
- **Free-claim exfiltration (audit #11).** A per-IP account-creation cap already
  exists (`buyerclaim:ip`, 10/hr), which bounds single-IP sybil farming. The
  residual — a distributed competitor farming dossiers across many IPs/free
  emails — is best closed by **delayed / gated contact reveal on FREE unlocks**
  (paid/premium reveal immediately; free reveals the owner contact after a short
  delay or a lightweight verification). That degrades the free-lead UX, so it's
  a product decision, not a silent patch.
- **Lob live-mail daily cap (audit #16).** Runaway-postcard spend is currently
  prevented outright by `assertLobTestMode()` (only `test_` Lob keys allowed —
  no live mailings possible). Before enabling live Lob: add a hard daily
  mailpiece cap (mirror the email morning-approval queue / `DEMAND_DAILY_CAP`)
  so a scoring bug can't mail thousands of real postcards.

## Round 3 — needs a paired env/DNS step or is deferred

- **Kill the auth fallback chains (audit #17, part 2).** `customer-auth` now
  throws in production (the exploitable hardcoded-secret fix shipped), but both
  buyer- and customer-auth still fall back to `OPERATOR_SHARED_SECRET` — and the
  operator *cookie value* IS that secret, so one leaked operator cookie can
  forge buyer + customer sessions. Fix = three DISTINCT secrets, no fallbacks.
  This can't be done blind: removing the fallback while prod has only
  `OPERATOR_SHARED_SECRET` set would lock everyone out. **Ops step first:** set
  distinct `BUYER_AUTH_SECRET` and `CUSTOMER_AUTH_SECRET` in Vercel, THEN the
  code drop of the `|| OPERATOR_SHARED_SECRET` fallbacks is safe.
- **Cousin sending domain (audit #19).** The code seam is in
  (`sendEmail({ stream: "campaign" })` → `CAMPAIGN_EMAIL_FROM`; the main cold
  pipelines — buyer-prospecting, residential-demand, nudges — already pass it).
  To ACTIVATE: verify a cousin domain (e.g. greenkeepmail.com) in Resend, set
  `CAMPAIGN_EMAIL_FROM` to it. Until set, cold sends fall back to the primary
  (no behavior change). Remaining cold sites (permits, renewals, outcome-check)
  should adopt `stream: "campaign"` too before scaling campaign volume.
- **Cron dead-man / positive heartbeat.** Failure alerting EXISTS (`cron-guard`
  emails `ALERT_EMAIL` on a throw + returns 500). What's missing: (a) confirm
  EVERY cron is wrapped in `guarded()`, and (b) a positive "pipeline ran" ping
  so a cron that never fires (Vercel didn't trigger it) is noticed — a catch
  block can't detect non-execution. Cheap: have the pipeline cron email a
  one-line summary on success; alert if none arrived by mid-morning.
- **Operator audit log.** Exports, queue approvals, and archives leave no trail.
  Add an `operator_audit` table (actor, action, target, timestamp) written from
  those mutations — wanted the first time inventory disappears and nobody can
  say why. Deferred (moderate build).
- **30-minute runtime settings pass (owner).** The remaining risk is in config
  the code can't see: Vercel env (distinct secrets present? preview envs?), SES
  receipt rules (spam/DKIM verdicts enabled?), Stripe dashboard (webhook secret
  rotation, allowed events), and Neon backup/PITR configuration. Walk this list
  against the live project.

## The pattern worth remembering

Both audits found the same shape: the **payment** path is hardened as if under
attack, while the **trust** paths (operator auth, inbound email, free claims)
assumed good faith. New surfaces should get the payment-path level of paranoia
by default.
