# CRM extraction packet

Self-contained extraction for **an M&A origination CRM for a boutique advisory firm**.
Target stack: **Neon** (serverless Postgres) · **Resend** (transactional email) · **Vercel** · **Next.js 14 App Router**.

**Nothing in the source repo was modified.** Everything in this packet is new, under `crm-extract/`.
No secret, key, token, connection string, or credential value appears anywhere in it — environment
variables are referenced **by name only**.

**Verified before hand-off.** The packet ships its own `tsconfig.json` and `vitest.config.ts` so both
checks are reproducible from the source repo root and will keep working after the directory moves:

| Check | Result |
|---|---|
| `npx tsc -p crm-extract --noEmit` | clean, 0 errors across all 35 TypeScript files |
| `npx vitest run --config crm-extract/vitest.config.ts` | **62 tests passed** across 3 files |
| `drizzle-kit generate` | 13 tables, 5 enums → `drizzle/0000_crm_init.sql` (checked in, 237 statements) |
| `npx tsc --noEmit` + `npx vitest run` (host app) | clean / 377 passed — the packet is excluded from both, so it cannot affect the source app's CI |

One real bug was found by writing those tests: `coerceValue`'s date branch used
`Date.parse()`, which accepts `2027-02-30` (V8 rolls it forward to Mar 2). Fixed to share
`isValidDateStr` with `revisit.ts` so there is one definition of "a real calendar day".

**A note on the host repo.** This directory initially fell inside the source repo's `tsconfig.json`
(`include: ["**/*.ts","**/*.tsx"]`) and `vitest.config.ts` (`include: ["**/*.test.ts"]`) — which is
how the first verification run happened, but it also meant the source app's CI was typechecking and
testing a packet meant for a different project. Both configs now `exclude` `crm-extract`, and the
packet carries its own configs instead. Two consequences worth knowing:

- The packet is **inert** with respect to this repo. It ships no runtime code paths into the app,
  and its tests and types no longer touch the app's CI.
- When you move the directory into the new project, delete the two `exclude` entries here and move
  `crm-extract/tsconfig.json` + `vitest.config.ts` to that project's root (dropping the `root` line
  in the vitest config).

---

## 1. Architecture

The shape is deliberately boring: **one Postgres, one Next.js app, no queue, no Redis, no
background worker, no API layer between the UI and the database.** Every page is a server
component that queries Neon directly; every mutation is a `<form action={serverAction}>` that
writes and calls `revalidatePath`. There is no client-side data fetching and no client state in
the extracted UI — a page either rendered with the right data or it didn't.

That choice is load-bearing for a boutique firm, not just taste. It means a handful of bankers get
a CRM whose entire failure surface is "did the query work", and it means the app costs almost
nothing to run when idle. The price is paid in three places, all documented in §6 and §7:
the Neon HTTP driver has **no transactions**, serverless functions have **no shared memory**
(hence a counter table where you'd normally reach for Redis), and a "board" gets a select-and-submit
control instead of drag-and-drop.

There are exactly **two scheduled jobs' worth of moving parts** — one cron (the revisit sweep) and
one inbound webhook (Resend) — and both are wrapped in the same guard/heartbeat/contradiction-check
harness, because the source app's most expensive outage was a cron that ran green every day while
silently doing nothing.

```
                        Vercel
  ┌──────────────────────────────────────────────────────────────────────┐
  │                                                                      │
  │  middleware.ts  (EDGE — cookie PRESENCE only, cannot verify HMAC)    │
  │        │  redirect to /login if no cookie                           │
  │        ▼                                                             │
  │  ┌──────────────── app/ (NODE runtime, server components) ────────┐  │
  │  │                                                                │  │
  │  │  /revisits ◀── THE queue      /companies      /companies/[id]  │  │
  │  │  /pipeline (stage board)      (search+filter) (record+timeline)│  │
  │  │        │                            │                │         │  │
  │  │        └── server actions ──────────┴────────────────┘         │  │
  │  │              (requireUser() re-verifies on every action)       │  │
  │  └────────────────────────┬───────────────────────────────────────┘  │
  │                           │                                          │
  │   ┌───────────────────────┴──────────────────────────┐               │
  │   │  crm/   revisit · companies · activity ·         │               │
  │   │         custom-fields · import · export · audit  │               │
  │   │  auth/  tokens (HMAC) · session                  │               │
  │   │  email/ resend · transactional · inbound ·       │               │
  │   │         suppression · alerts                     │               │
  │   │  runtime/ ratelimit · cron-guard · tripwire      │               │
  │   └───────────────────────┬──────────────────────────┘               │
  │                           │ db/index.ts (lazy Proxy, no-store fetch) │
  │  ┌────────────────────────┴───────────────────────┐                  │
  │  │ /api/cron/revisit-sweep  (CRON_SECRET, 0 12 * * 1-5)             │
  │  │ /api/webhooks/resend     (svix HMAC, multi-secret, fail closed)  │
  │  └────────────────────────┬───────────────────────┘                  │
  └───────────────────────────┼──────────────────────────────────────────┘
                              │ HTTPS (fetch)                 ▲ webhooks
                              ▼                               │
                   ┌────────────────────┐          ┌───────────────────┐
                   │   Neon Postgres    │          │      Resend       │
                   │  13 tables, 5 enums│          │ send + inbound +  │
                   │  usage_counter =   │          │ delivery events   │
                   │  rate limit AND    │          └───────────────────┘
                   │  once-ever marker  │
                   └────────────────────┘
```

**Read/write split worth internalizing:** the revisit queue at `/revisits` is a **live query**, not a
materialized list the cron populates. The cron only *emails* and *stamps*. If the cron never runs
again, the queue is still correct when a banker opens it. That inversion is the single most
important reliability decision in the packet — the thing that must never silently break is a pure
`WHERE revisit_date <= today`, not a job.

### 1b. Requirement coverage

Every behaviour you listed, mapped to code — or called out as not covered.

| # | Required behaviour | Covered by | Status |
|---|---|---|---|
| 1 | **Companies as primary record, contacts attached** | `db/schema.ts` (`company`, `contact` FK'd to company, `ON DELETE cascade`) · `crm/companies.ts` · `app/companies/*` | ✅ Complete |
| 2 | **Deal pipeline, custom stages + long-lived nurture** | `pipeline_stage` rows (not an enum) + `stage_kind` = `open\|nurture\|won\|lost` · `app/pipeline/page.tsx` renders columns from rows · `moveDealAction` writes a `stage_change` timeline row | ✅ Complete. Stage **admin UI not built** — stages come from `db/seed.ts`; editing is an `UPDATE` today. |
| 3 | **`revisit_date` on any record + something that surfaces it when due** | `crm/revisit.ts` (470 lines, the flagship) · `revisit_date`/`_note`/`_user_id`/`_surfaced_at` on **all three** of `company`, `contact`, `deal`, each with a partial index · `app/revisits/page.tsx` (live queue, most-overdue first) · `app/api/cron/revisit-sweep/route.ts` (weekday digest) · `crm/revisit.test.ts` (22 tests) | ✅ Complete, and the most tested thing here |
| 4 | **Full activity timeline: calls, emails, letters, notes** | one `activity` table, `activity_kind` enum covers `call\|email_out\|email_in\|letter\|meeting\|note\|stage_change\|revisit_due\|system` · `crm/activity.ts` · `logCallAction`/`logNoteAction`/`logLetterAction` · timeline on `app/companies/[id]/page.tsx` | ✅ Complete for logging. **No telephony or mail-vendor integration** — calls and letters are hand-logged (correct for a boutique firm; see §7). |
| 5 | **Arbitrary custom fields (numeric, enum, boolean, date)** | `custom_field_def` + `custom_field_value` with typed columns · `crm/custom-fields.ts` (`coerceValue`, `recordsWhereNumber`) · edit form on the record page · 8 starter fields in `db/seed.ts` · 17 tests | ⚠️ **Field *editing* is covered; field *creation* has no UI.** `createFieldDef()` exists and is callable, but an admin screen for "add a field" is not in the packet. |
| 6 | **Two-brand attribution, one backend** | `brand` table · `brand_id` on `company`, `deal`, `activity` · `fromForBrand()` picks the per-brand verified sender · brand filter chips on `/companies` and `/pipeline` | ⚠️ Covered in the data model and in sending. **No brand admin UI** (two rows from `db/seed.ts`), and **no per-brand theming of the app shell** — the brand affects *outbound identity*, not the operator's screen. |
| 7 | **Bulk import/upsert from JSON or CSV, idempotent, re-runnable** | `crm/import.ts` — `parseCsv` (RFC-4180, multi-line quoted fields, BOM, CRLF) · `importCompanies`/`importCompaniesCsv` · idempotency enforced by **three DB constraints**, not by code · `import_batch` provenance rows · 23 tests | ⚠️ **The library is complete; there is no upload route or screen.** Today you call it from a `tsx` script. A `POST /api/import` + file input is ~40 lines and is the single highest-value thing to add. |
| 8 | **Transactional email via Resend, delivery logged to the timeline** | `email/resend.ts` `sendEmail({ logAs: {...} })` writes an `email_out` activity row stamped with the Resend message id · `app/api/webhooks/resend/route.ts` updates *that same row* on `delivered/opened/clicked/bounced/complained` · `email/inbound.ts` writes `email_in` rows for replies · delivery state renders per-row on the timeline | ⚠️ **Plumbing complete end-to-end; there is no compose-and-send UI.** `sendEmail` is currently exercised by the digest and ops alerts. A "send this prospect an email" form on the record page is not in the packet. |

**Also not covered (needed before this runs as an app):**

- **`/login` and `/api/auth/*`.** `auth/tokens.ts` and `auth/session.ts` are complete and tested by
  use, and `middleware.ts` redirects to `/login` — but the login *page* and the
  request-link / verify-link route handlers are **not in the packet**. This is the one gap that
  blocks first boot. Roughly 60 lines: a form that POSTs an email → `signLogin()` → `sendEmail` with
  `actionEmail()` → a GET route that `verifyLogin()`s, looks up `crm_user`, and sets the session
  cookie with `sessionCookieOptions`.
- **App shell**: no `app/layout.tsx`, `globals.css`, `tailwind.config.ts`, `next.config.js`,
  `package.json`, or `vercel.json`. The pages assume Tailwind utility classes are available.
- **Task/reminder objects other than revisits.** Deliberate: a second reminder system competes with
  the first, and then neither is trusted.

---

## 2. File manifest

35 TypeScript files, 5,405 lines, plus this file, two configs, and the generated migration. "Origin" is the path in the source repo (`cjkootch/commercial_property_bidder`).
**NET-NEW** means nothing in the source did this job.

### Database

| File | Lines | Purpose | Origin |
|---|---|---|---|
| `db/schema.ts` | 487 | 13 tables, 5 enums. The CRM spine. | Structural habits from `lib/db/schema.ts` (1,228 lines, 36 tables); **not** a copy — see §3 |
| `db/index.ts` | 49 | Lazy Neon HTTP client behind a `Proxy`; `cache:"no-store"`; never connects at import time | `lib/db/index.ts` — **reusable as-is**, ported near-verbatim |
| `db/drizzle.config.ts` | 25 | `drizzle-kit` config. Migrations are files in git, applied in order — never `db push` | `drizzle.config.ts` |
| `db/seed.ts` | 116 | Idempotent seed: 2 brands, 8 stages (incl. `nurture`), 8 company custom fields, admin from `SEED_ADMIN_EMAIL` | NET-NEW |
| `drizzle/0000_crm_init.sql` | 237 | Generated DDL — the authoritative schema artifact | generated |
| `drizzle/meta/*` | — | drizzle-kit journal + snapshot | generated |
| `tsconfig.json` | 26 | Standalone typecheck: `npx tsc -p crm-extract --noEmit`. Mirrors the settings the code was verified against | `tsconfig.json`, scoped |
| `vitest.config.ts` | 22 | Standalone test run: `npx vitest run --config crm-extract/vitest.config.ts` | `vitest.config.ts`, scoped |

### The revisit engine — the reason this packet exists

| File | Lines | Purpose | Origin |
|---|---|---|---|
| `crm/revisit.ts` | 470 | Pure predicates (`todayInTz`, `isDue`, `daysUntil`, `addDays`, `isValidDateStr`); reads (`listDueRevisits`, `countDueRevisits`); writes (`setRevisit`, `snoozeRevisit`, `completeRevisit`); the sweep (`runRevisitSweep`) claiming each item via `onceEver`; `revisitDigestText` | **NET-NEW as a feature.** Pattern distilled from four one-off jobs in `lib/pipeline/{renewals,hold-expiry,outcome-check,long-tail}.ts` — `renewals.ts` contributed the pure-predicate shape |
| `crm/revisit.test.ts` | 152 | 22 tests: inclusivity, null, year/month boundaries, DST-proof day math, leap day, a 1,096-day fuse, timezone boundary, digest content | NET-NEW |
| `app/revisits/page.tsx` | 180 | The queue: most-overdue first, note verbatim, snooze presets (+1w/+1m/+3m/+1y), Done requires an outcome, `mine` filter | NET-NEW |
| `app/revisits/actions.ts` | 78 | `snoozeRevisitAction`, `completeRevisitAction`, `setRevisitAction` — each re-verifies via `requireUser()` | NET-NEW |
| `app/api/cron/revisit-sweep/route.ts` | 81 | `requireCronSecret` → `guarded` → sweep → digest → `checkSweepOutput` → heartbeat + prune. `?dry=1` supported | Harness from `lib/cron-guard.ts` + `app/api/cron/*`; the job is NET-NEW |

### Core CRM domain

| File | Lines | Purpose | Origin |
|---|---|---|---|
| `crm/companies.ts` | 291 | `companyKey()` (suffix/punctuation normalization), `domainOf()`, `upsertCompany` (returns `{id,created}`, nulls never clobber), `upsertContact`, `blockCompany`/`unblockCompany`, `searchCompanies`, `stalledCompanies` | `lib/leads/companies.ts` — **the single most valuable piece of reuse**; generalized off `prospect_company` |
| `crm/activity.ts` | 160 | `logActivity`, `companyTimeline` (one indexed query + joins), `companyEngagement` via SQL `count(*) filter (…)`, `recentActivity` | Merges `lib/leads/activity.ts` + the email/SMS send tables; the SQL-aggregate approach replaces the source's in-JS reduction |
| `crm/custom-fields.ts` | 228 | `listFieldDefs`, `createFieldDef`, pure `coerceValue`/`readValue`, `setFieldValue` (with `expectEntity` guard), `fieldsForRecord`, `fieldValuesForRecords`, `recordsWhereNumber` | NET-NEW — the source had ~20 purpose-built `jsonb` columns and could not filter its own data |
| `crm/custom-fields.test.ts` | 148 | 17 tests: one-column-per-type, `$1,250,000`, enum fail-closed, impossible dates, plus the suppression split | NET-NEW |
| `crm/import.ts` | 296 | `parseCsvLine`, `parseCsv`, `toImportRow` (`cf_*` → custom fields), `importCompanies` (per-row try/catch, error list capped at 200), `importCompaniesCsv` | `scripts/import-residential-leads.ts` — parser ported and **fixed** (source split on `\n` first, mangling multi-line quoted fields); dedupe changed from racy SELECT-then-skip to DB `ON CONFLICT` |
| `crm/import.test.ts` | 162 | 23 tests: quoted commas, doubled quotes, BOM, CRLF, multi-line fields, key collapsing, alias columns, formula injection | NET-NEW |
| `crm/export.ts` | 49 | `csvEscape`, `toCsv` (explicit column order), `csvResponse` (`no-store`), `csvSafeText` (Excel formula-injection guard) | `lib/leads/package.ts` + `app/leads/export/route.ts` — carries the **GET-never-mutates** rule, learned when a link prefetcher destroyed inventory |
| `crm/audit.ts` | 69 | `logAudit` (best-effort, never fails its caller), pure `diffFields`, `recordHistory` | NET-NEW — the source had no audit trail |

### Email

| File | Lines | Purpose | Origin |
|---|---|---|---|
| `email/resend.ts` | 210 | Brand-aware `sendEmail` (**never throws**; `logAs` writes the `activity` row with the Resend id), `verifyResendSignature` (multi-secret, timing-safe, fails closed), `htmlToText`, `fromForBrand`, failure tripwire | `lib/integrations/resend.ts` — **reusable as-is**, generalized from two hardcoded streams to brands |
| `email/transactional.ts` | 94 | `actionEmail` (bulletproof button + visible link fallback), `proseEmail` (+ CAN-SPAM footer), `digestEmail`. All caller strings HTML-escaped | `lib/email/transactional.ts` |
| `email/inbound.ts` | 232 | MIME parsing (`decodeWords`, `decodeQp`, `extractText`), `domainOfEmail` with a free-mail exclusion set, `matchInboundSender` (contact email → company email → domain), `recordInboundReply`, `repliedWithoutRevisit` | `lib/email/inbound.ts` — ported near-verbatim; the matcher is repointed at companies |
| `email/suppression.ts` | 57 | `MARKETING_ONLY_REASONS`, pure `rowsBlockTransactional`, `transactionalBlocked`, `marketingBlocked`, `suppress`, `loadSuppressed` | `lib/suppression.ts` — **with the bug fixed**: the source blocked *purchases* on a marketing opt-out |
| `email/alerts.ts` | 63 | `alertOps`, `alertInboundReply` (replies to the alert go to the prospect) | `lib/email/{operator-alerts,reply-alert}.ts` |
| `app/api/webhooks/resend/route.ts` | 139 | Delivery/engagement → the one `activity` row via `external_id`; auto-suppress on bounce/complaint; `svix-id` idempotency | `app/api/webhooks/resend/route.ts` — reduced from ~120 lines of near-duplicate UPDATEs across 3 tables to one UPDATE per event |

### Runtime primitives

| File | Lines | Purpose | Origin |
|---|---|---|---|
| `runtime/ratelimit.ts` | 147 | `windowStart`, `rateLimit`, `rateLimitCount`, `releaseRateLimit`, `FOREVER_WINDOW`, `onceEver`, `oncePerDay`, `pruneUsageCounters` | `lib/ratelimit.ts` — **reusable as-is.** No Redis: one upsert per check |
| `runtime/cron-guard.ts` | 49 | `requireCronSecret` (fails **closed** when the secret is unset), `guarded(name, fn)` | `lib/cron-guard.ts` |
| `runtime/tripwire.ts` | 110 | `recordHeartbeat`, `heartbeatAgeHours`, `isStale`, `checkHeartbeat`, `isContradiction`, `checkSweepOutput`, `countMarkers` | `lib/pipeline/low-volume.ts` generalized — exists because volume decayed to zero across a week of green crons |

### Auth

| File | Lines | Purpose | Origin |
|---|---|---|---|
| `auth/tokens.ts` | 95 | HMAC-SHA256 tokens (`login` 30m / `session` 12h / `unsub` 10y), `timingSafeEqual` with a length pre-check, throws in production without `AUTH_SECRET` | `lib/buyer-auth.ts` — narrowed from 4 token kinds, repointed at `crm_user` |
| `auth/session.ts` | 60 | `currentUser` (verifies HMAC **and** `disabled_at is null`), `requireUser`, `requireAdmin`, cookie options | NET-NEW — the source gated its whole operator area behind one shared secret |
| `middleware.ts` | 52 | Edge gate. Segment-boundary `isPublic` (so `/api/webhooks-admin` can't be publicized by prefix), **presence-only** cookie check | `middleware.ts` — reduced from 3 audiences to 1 |

### UI

| File | Lines | Purpose | Origin |
|---|---|---|---|
| `app/companies/page.tsx` | 240 | List: GET search form, filter chips (all/due/scheduled/unscheduled/blocked + per-brand), sort, 50-row pagination, engagement columns from the SQL aggregate | `app/companies/page.tsx` (175) as a template. **The source's data access was rewritten** — it loaded 1,000 profiles + *every* outreach row and reduced in JS |
| `app/companies/[id]/page.tsx` | 436 | Record page: identity header, **revisit control at the top**, contacts/deals/custom-field forms, log-call & log-note forms, unified timeline with per-row delivery state, change history | `app/companies/[id]/page.tsx` (471) as a template |
| `app/companies/actions.ts` | 89 | `logCallAction`, `logNoteAction`, `logLetterAction`, `setCustomFieldAction`, `blockCompanyAction`, `unblockCompanyAction` | NET-NEW |
| `app/pipeline/page.tsx` | 203 | Stage board from `pipeline_stage` rows; nurture column styled distinctly and showing revisit dates; per-card no-JS move form | NET-NEW — the source had no board |
| `app/pipeline/actions.ts` | 66 | `moveDealAction` — writes a `stage_change` activity + audit row, stamps/clears `closed_at` | NET-NEW |

---

## 3. Schema

**Authoritative DDL: [`drizzle/0000_crm_init.sql`](drizzle/0000_crm_init.sql)** — generated from
`db/schema.ts` by `drizzle-kit generate`, 13 tables, 5 enums, 237 statements. It is checked in so you
can read the real thing rather than a prose summary that drifts. Below are the parts that carry a
decision, plus what was dropped from the source.

### The revisit columns (present identically on `company`, `contact`, `deal`)

```sql
"revisit_date"        date,                      -- NULL = not scheduled
"revisit_note"        text,                      -- WHY. Shown verbatim in the queue and digest
"revisit_user_id"     uuid,                      -- whose queue; falls back to owner_user_id
"revisit_surfaced_at" timestamp with time zone,  -- set by the sweep; cleared when the date changes

CREATE INDEX "company_revisit_idx" ON "company" USING btree ("revisit_date")
  WHERE revisit_date is not null;
```

Three decisions worth defending:

- **`date`, not `timestamptz`.** "Surface this on this calendar day" must not depend on the reader's
  timezone. Drizzle returns `date` as a `"YYYY-MM-DD"` string, and zero-padded ISO strings compare
  correctly with `<=`, so `isDue()` is a string comparison with no `Date` object in the path. The
  source app hit the timezone version of this bug twice with day-bucketed counters.
- **The index is partial.** Almost no rows have a revisit scheduled; the queue query and the sweep
  both stay on a small index instead of scanning the table.
- **`revisit_note` is not optional in practice.** A due list of bare company names gets ignored. The
  note is what lets a banker re-enter a two-year-old conversation, so the queue and the digest both
  render it verbatim, untruncated.

### Idempotency constraints — the entire re-run safety story

```sql
CONSTRAINT "company_dedupe_key_unique"          UNIQUE("dedupe_key")
CREATE UNIQUE INDEX "contact_company_email_uniq" ON "contact" ("company_id","email")
  WHERE email is not null;
CONSTRAINT "custom_field_value_def_record_uniq" UNIQUE("def_id","record_id")
CONSTRAINT "usage_counter_key_window_start_pk"  PRIMARY KEY("key","window_start")
```

Import idempotency is **enforced by the database, not by the importer's memory**. Two importers
running at once, or the same file loaded twice, converge on one row via `ON CONFLICT` rather than
duplicating or throwing. This matters specifically because the HTTP driver has no transactions
(§6) — a unique index is the only concurrency arbiter available.

The `contact` index is partial so a company may hold several contacts with no email address, while
still permitting only one row per `(company, email)`. Addresses are lowercased **by the writer**
(`upsertContact`), not by a `lower()` expression index, because `ON CONFLICT` needs a plain column
target to be portable.

### Notes on domain-specific columns

The source schema was **not** ported — reusing it would have meant inheriting 36 tables about turf
measurement. It was read for structural habits only. For the record, this is what was left behind
and what replaced it:

| Source table / column | Verdict |
|---|---|
| `property` (parcel geometry, `sqft_turf`, `mapbox_*`, ATTOM fields) | **Dropped entirely.** A landscaping property has no analogue here |
| `contact.property_id` | **Repointed** to `contact.company_id` — the one change that made the table usable |
| `property_status` (10-value pgEnum) + `outreach.status` (7-value text) + proposal status | **Dropped.** Three parallel hardcoded pipelines, none configurable. Replaced by `pipeline_stage` **rows** + `stage_kind` |
| `prospect_company.key` | **Kept as the central idea** → `company.dedupe_key` |
| `prospect_company.blocked_at` | **Kept** → `company.blocked_at` + `blocked_reason` |
| `prospect_company.{line_type,cell_lookup_at}` (phone-enrichment caches) | **Dropped.** Telephony enrichment is out of scope |
| `attom`, `dossier`, `teaser`, `signal_summary` (~20 purpose-built `jsonb` columns) | **Dropped and replaced** by `custom_field_def`/`custom_field_value`. These columns are exactly why the source couldn't filter its own enrichment data in SQL |
| `lead_activity` + `email_send` + `sms_send` | **Merged** into one `activity` table. The source merged them in the page component, and that merge was where attribution bugs lived |
| `buyer`, `lead_unlock`, `claim_event`, `usage_counter` | Marketplace tables **dropped**; `usage_counter` **kept verbatim in spirit** |
| `outreach.buyer_outreach` two partial unique indexes | **Pattern kept** (partial unique index as concurrency arbiter), tables dropped |
| SMS everywhere (`sms_send`, opt-out phrase handling, `suppression` conflation) | **Dropped.** Cold SMS to business owners is a different compliance regime than cold email; the suppression **reason split** was kept and fixed |

### New-schema columns you may want to rename or drop

- **`deal.value_cents` is `bigint`.** `integer` cents overflows above ~$21M, which is inside the
  range of an ordinary lower-middle-market deal. If "value" means *fee* rather than *enterprise
  value*, rename it — the semantics of that column drive every pipeline total on the board.
- **`company.source`** is free text (`"list:sic_3441_tx"`, `"referral:jdoe"`). If provenance
  becomes something you report on, promote it to a table.
- **`brand.color` / `logo_url`** are used only for outbound email styling today, not for the app
  shell. Drop them if you never brand the emails.
- **`activity.email_address`** duplicates what you could join through `contact`. It's there on
  purpose — a send goes to an address that may not (yet) be a contact row — but it will look
  redundant on first read.
- **`custom_field_value.record_id` is not a foreign key.** One value table serves companies,
  contacts and deals, so referential integrity is enforced by the writer (`setFieldValue`'s
  `expectEntity` check) plus the def's `entity` column. This is a **real trade-off, not an
  oversight**: the alternative was three near-identical value tables. The cost is that a deleted
  company leaves orphaned value rows — add a cleanup query, or accept the drift.

---

## 4. Dependencies

Exact versions resolved from **this repo's `package-lock.json`**, which is the toolchain the packet
was typechecked and tested on. The extract imports **six packages total** — verified by grepping
every non-relative import in `crm-extract/`.

### Runtime

| Package | Version | Notes |
|---|---|---|
| `next` | **14.2.35** | App Router. 14.x, not 15 — the packet's `searchParams` are plain objects; **Next 15 makes them a Promise**, so the page components need `await searchParams` on upgrade. Not abandoned; not heavy for what it does |
| `react` / `react-dom` | **18.3.1** | Paired with Next 14 |
| `drizzle-orm` | **0.45.2** | Actively developed, fast-moving. Its expression-index and `ON CONFLICT` typings are the *least* stable part of the API — the packet deliberately avoids expression conflict targets for that reason |
| `@neondatabase/serverless` | **1.1.0** | The HTTP/WebSocket driver. **Paid dependency in the sense that it's Neon-specific** — swapping to plain Postgres means `drizzle-orm/node-postgres` + `pg` and a rewrite of `db/index.ts` (nothing else changes) |

### Dev

| Package | Version | Notes |
|---|---|---|
| `typescript` | **5.9.3** | `strict: true`, `isolatedModules: true` |
| `drizzle-kit` | **0.31.10** | Migration generator. Version-coupled to `drizzle-orm` — upgrade the pair together or `generate` fails |
| `vitest` | **2.1.9** | Prints a "CJS build of Vite's Node API is deprecated" warning on every run; harmless, gone in Vitest 3 |
| `tsx` | **4.22.4** | Runs `db/seed.ts` and any import script |
| `tailwindcss` / `postcss` / `autoprefixer` | **3.4.19** / **8.5.15** / **10.5.2** | The UI uses Tailwind utility classes. Tailwind **4** changes the config format — pin 3.x or convert the class names |
| `@types/node` / `@types/react` | **20.19.43** / **18.3.31** | |

### Deliberately not carried over

Present in the source, **not** needed here — this is most of the source repo's weight:

`mapbox-gl` + `@mapbox/mapbox-gl-draw` + `@turf/*` (geospatial — **paid** Mapbox tiles above the free
tier, and hundreds of KB of client JS) · `@react-pdf/renderer`, `jpeg-js`, `pngjs`, `qrcode`
(document/image generation — heavy) · `@anthropic-ai/sdk` (**paid** per-token) · `@vercel/blob`
(**paid** storage) · `playwright` (browser automation; heavy CI) · `zod` (the source uses it, the
extract doesn't — `coerceValue` and `toImportRow` do their own narrow validation and return
`{ok:false,error}` rather than throwing).

**No abandoned packages in the extract.** The riskiest version coupling is
`drizzle-orm` ↔ `drizzle-kit`; the riskiest upgrade is Next 14 → 15 (`searchParams`).

Also note: **no email SDK.** `email/resend.ts` calls the Resend REST API with `fetch`. That was a
good call in the source and it stays one — one less dependency to version-bump, and the failure
mode is a status code you can read.

---

## 5. Environment variables

**Names and purposes only. No values.** Every one of these is read via `process.env.<NAME>` and
nothing in this packet contains a credential.

| Name | Required | Purpose | Failure mode if missing |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | Neon connection string. Read lazily on first query, never at import time | Throws at request time (`"DATABASE_URL is not set."`) — deliberately *not* at build time |
| `AUTH_SECRET` | **Yes** | HMAC key for login/session/unsubscribe tokens | **Throws in production.** In development falls back to a known dev string, so every session would be forgeable if this ever shipped unset |
| `CRON_SECRET` | **Yes** | Bearer secret on `/api/cron/*`. Vercel Cron sends it automatically | **Fails closed** — the route 401s when the var is unset, rather than running unauthenticated |
| `RESEND_API_KEY` | **Yes** (for mail) | Resend REST auth | `sendEmail` returns `{ok:false}`; nothing throws, nothing sends |
| `RESEND_FROM` | **Yes** (for mail) | Fallback sender, `"Name <addr@domain>"`. Per-brand senders live in `brand.from_email` and win | Send fails with a clear error |
| `RESEND_WEBHOOK_SECRET` | **Yes** (for webhooks) | Svix signing secret(s). **Comma-separated list supported** — each Resend webhook (sending vs receiving) has its own secret, and a single-secret check silently 401s the second one until Resend auto-disables it | Webhook route 401s everything — **fails closed on purpose**: an unsigned webhook could suppress arbitrary addresses or forge inbound replies onto a timeline |
| `RESEND_REPLY_TO` | No | Default reply-to | Falls back to the From address |
| `APP_BASE_URL` | **Yes** in practice | Absolute origin for links in emails (`https://crm.example`) | Digest links render relative and are unclickable in a mail client |
| `ALERT_EMAIL` | Recommended | Where ops alerts and inbound-reply alerts go | Alerts log to console and are dropped |
| `CRM_TIMEZONE` | No | IANA zone deciding what "today" means for revisits (default `America/New_York`) | Defaults; get it wrong and revisits surface a day early or late |
| `EMAIL_FAIL_ALERT_AT` | No | Failed-send count per day before ops is paged once (default `10`) | Defaults |
| `REVISIT_DIGEST_FALLBACK_EMAIL` | No | Where revisits with no assigned owner get digested | Ownerless revisits appear in the queue but nobody is emailed |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_NAME` | Seed only | First admin user for `db/seed.ts` | Seed warns and creates no admin — you'd have no way in |
| `NODE_ENV` | (platform) | Set by Vercel. Gates the `AUTH_SECRET` throw and the `secure` cookie flag | — |

Vercel setup: all of these go in Project → Settings → Environment Variables. `CRON_SECRET` is the
one Vercel populates and forwards to cron invocations itself.

> **Housekeeping, unrelated to this packet:** a Resend webhook signing secret was pasted into our
> chat earlier in this session. It is not in this packet or in any file written here, but it should be
> **rolled in the Resend dashboard** — treat anything pasted into a chat log as disclosed.

---

## 6. Port notes: Neon + Resend + Vercel

The source app already runs on exactly this stack, so **there is no migration** — no ORM swap, no
driver change, no dialect differences. What follows is the set of constraints this stack imposes,
each of which shaped code in the packet.

### Neon: no transactions on the HTTP driver

`db/index.ts` uses `drizzle-orm/neon-http`, which issues each query as an independent HTTPS request.
**There is no `db.transaction()`.** Multi-statement atomicity does not exist. Every write in this
packet is designed around that:

| Where you'd want a transaction | What the packet does instead |
|---|---|
| Import: "check then insert" | `dedupe_key` UNIQUE + `ON CONFLICT DO UPDATE`. The DB arbitrates; two racing importers converge |
| Sweep: "email once per due item" | `onceEver('revisit:<entity>:<id>:<date>')` — an INSERT on `usage_counter`'s composite PK that succeeds exactly once, ever |
| Webhook: "don't double-count opens" | `svix-id` claimed as a once-ever marker + `coalesce()` so the *first* open keeps the timestamp while the count increments |
| Stage move: "update + log atomically" | Accepted as non-atomic. A crash between them loses the timeline row, not the state |

**If you want real transactions**, swap the two import lines in `db/index.ts` to
`drizzle-orm/neon-serverless` and `Pool` from `@neondatabase/serverless` — the WebSocket driver
supports `db.transaction()`. Everything else in the packet keeps working, because nothing depends on
its absence, only on compensating for it. The cost is connection setup latency per invocation and
real pooling concerns.

### Neon: connection pooling in a serverless world

Each Vercel invocation is its own isolate. Over the HTTP driver there is **no connection to pool** —
every query is a stateless request, so the classic serverless failure ("500 lambdas, 500 idle
Postgres connections, `too many clients`") cannot happen. This is the main reason to stay on
`neon-http`.

If you move to the WebSocket pool: use the **`-pooler`** (PgBouncer) hostname in `DATABASE_URL`, and
keep `max` small (1–2) since each isolate serves one request at a time. Prepared statements behave
differently through PgBouncer's transaction pooling — Drizzle's default query mode is fine, but be
deliberate about it.

**Two footguns already handled in `db/index.ts`, worth not undoing:**

1. **No connect at import time.** `next build` imports every route module during "collecting page
   data". If this module connected — or threw — on import, the *build* would require `DATABASE_URL`,
   a runtime secret. The client is materialized on first query behind a `Proxy`.
2. **`fetchOptions: { cache: "no-store" }`.** The Neon HTTP driver queries via `fetch()`, which
   Next.js would otherwise put in its Data Cache and serve **stale**. Rows written out of band (the
   cron, the webhook, `psql`) would silently not appear. Every page also sets
   `export const dynamic = "force-dynamic"` for the same reason.

### Vercel: Node vs Edge, and why the split is not optional

`middleware.ts` runs on the **edge runtime**, which has **no `node:crypto`**. It therefore *cannot*
verify an HMAC session token, and the packet does not pretend otherwise: middleware checks that a
cookie **exists** and redirects if not. Real verification is `auth/session.ts` `requireUser()`,
called by every page and every server action.

> **Do not "optimize away" the server-side `requireUser()` believing middleware covers it.** It does
> not. Middleware here is a redirect convenience; the security boundary is in the page/action.

Everything that touches `node:crypto` — `auth/tokens.ts`, `email/resend.ts`'s signature
verification — is Node-only. The two route handlers declare `export const runtime = "nodejs"`
explicitly. The cron route also sets `maxDuration = 120`; the sweep does three indexed queries plus
one email per recipient, so it should finish in single-digit seconds, but the default 10s limit on
some plans is uncomfortably close for a job you only find out failed the next morning.

`middleware.ts` must be placed at the **project root** (not in `app/`), and its `PUBLIC_PREFIXES`
list must include the webhook and cron paths — a signature-verified endpoint that middleware
redirects to `/login` is an endpoint Resend sees as broken.

### Vercel: cron

```jsonc
// vercel.json
{ "crons": [{ "path": "/api/cron/revisit-sweep", "schedule": "0 12 * * 1-5" }] }
```

Cron schedules are **UTC**. `0 12 * * 1-5` is 7am CT / 8am ET on weekdays — in the inbox before the
day starts, and never on a Saturday, because an ignored reminder is a dead reminder. If the firm is
not in US Eastern, change both this expression and `CRM_TIMEZONE`; they are two independent settings
and disagreeing is a silent off-by-one-day.

Note the plan limits: Hobby allows a small number of cron jobs at day-granularity precision. This
packet needs exactly one.

### Resend

- **Verify a separate sending domain (or subdomain) per brand**, with SPF/DKIM/DMARC on each. This is
  the whole point of `brand.from_email`: a reputation problem on one brand must not put the other
  brand's mail in spam. Do not run both brands off one domain to save setup time.
- **Two webhooks, two signing secrets.** Sending events (`email.delivered`, `.opened`, `.clicked`,
  `.bounced`, `.complained`) and inbound receiving (`email.received`) are configured separately and
  each gets its own secret. `RESEND_WEBHOOK_SECRET` accepts a **comma-separated list** for exactly
  this reason — in the source app a single-secret check 401'd the second webhook until Resend
  auto-disabled it, and inbound replies went unseen for five days.
- Point both webhooks at `POST /api/webhooks/resend`, and confirm the path is in
  `PUBLIC_PREFIXES`.
- Resend/Svix **retries any non-2xx or timeout**. The route returns 200 for event types it doesn't
  handle (a 4xx would make Svix retry forever over something you don't care about) and 500 only when
  a handler genuinely failed. See §7 for the one interaction between retries and the idempotency
  marker.
- `sendEmail` always sends **multipart** — HTML-only mail is a bot signature that spam filters
  penalize. A plain-text part is derived from the HTML when the caller doesn't supply one.
- Bounces and complaints **auto-suppress** the address. That is not optional politeness; it is what
  stops the next import from rediscovering the company and re-sending to a dead mailbox.

---

## 7. Known rough edges

Honest assessment. The pieces I'd rewrite are named as such.

### Blocks first boot

1. **There is no `/login` page and no `/api/auth/*` routes.** `middleware.ts` redirects to `/login`;
   nothing serves it. `auth/tokens.ts` + `auth/session.ts` give you every primitive
   (`signLogin`/`verifyLogin`, `sessionCookieOptions`, `sessionCookieValue`) and `actionEmail()`
   renders the magic-link email — but the ~60 lines that wire them together are not here. **Write
   this first.**
2. **No app shell** — no `layout.tsx`, `globals.css`, `tailwind.config.ts`, `next.config.js`,
   `package.json`, `vercel.json`. The pages assume Tailwind classes exist. Mechanical, but it's the
   difference between "files" and "an app".
3. **No import UI.** `importCompaniesCsv()` is complete and tested; nothing calls it over HTTP.
   Today: a `tsx` script. A `POST /api/import` with a file input is the highest-value 40 lines you
   can add, and it must be **POST** — see the GET-never-mutates rule in `crm/export.ts`.

### Design limits I chose on purpose (and would defend)

4. **Sessions cannot be revoked before they expire.** Stateless HMAC means no session table to
   delete from. Mitigated two ways: a 12-hour TTL, and `currentUser()` checks
   `crm_user.disabled_at` on **every** request — so disabling a user does lock them out immediately,
   even though their token stays cryptographically valid. If you need true per-session revocation,
   that's a session table, and it's a query on every request.
5. **No drag-and-drop on the pipeline board.** Each card carries a `<select>` + Move button, so the
   board works with **zero client JavaScript** and cannot break in a way that loses a stage change.
   Dragging needs a client component plus optimistic updates. Worth adding later; wrong thing to
   depend on now.
6. **`custom_field_value.record_id` has no FK** (see §3). Deleting a company orphans its custom
   values. Add a cleanup query or accept the drift.
7. **Calls and letters are hand-logged.** No telephony, no mail vendor. For a firm where a partner
   makes fifteen calls a day, a "log call" form is right and an integration is overhead. Revisit if
   headcount changes.
8. **Three queries merged in JS in `listDueRevisits`**, not a SQL `UNION`. The due set is a working
   queue — tens of items, not thousands — and this keeps each query on its own partial index.
   Documented in the function. If a firm ever accumulates tens of thousands of overdue items, make
   it a `UNION ALL` with `LIMIT` pushed down; but by then the real problem is that nobody is
   working the queue.

### Actual sharp edges

9. **The webhook's idempotency marker is claimed *before* the handler runs.** If a handler throws,
   the route returns 500 so Svix retries — but the marker is already claimed, so the retry is
   skipped and **that event is lost**. Claiming after success instead would let a *timeout*
   (response lost, work done) double-count. I chose "lose an open count" over "double-count an open
   count"; if you'd rather have the opposite, move the `onceEver` call after the switch. Either way
   it is a real trade-off, not a solved problem.
10. **`onceEver` fails OPEN.** If the counter INSERT itself errors, it returns `true` (proceed) and
    logs. So a database blip during the sweep can produce a duplicate digest email. Deliberate — a
    reminder system that goes silent on infrastructure trouble is worse than one that occasionally
    repeats itself — but it means "exactly once" is really "once, unless the marker write failed".
11. **`updated_at` is maintained by the app layer**, not a trigger. Drizzle has no portable
    `ON UPDATE`. Any code path that writes a row and forgets `updated_at: new Date()` silently
    leaves a stale timestamp, and `stalledCompanies()` reads that column. Grep for `.set({` when you
    add writers.
12. **`pipeline_stage.is_default` has no uniqueness constraint.** Two rows flagged default is
    legal and the behaviour is then arbitrary. One partial unique index
    (`WHERE is_default`) fixes it; I left it out rather than guess at your stage-admin flow.
13. **The company list's engagement columns cost a second aggregate query** per page. Fine at 50 rows
    a page and thousands of companies; if the firm loads a hundred thousand rows, the aggregate
    wants a materialized column.
14. **`companyKey()` is aggressive.** It strips `inc/llc/ltd/corp/co/company/plc/lp/llp/holdings/group`
    to merge `"Acme Industries, Inc."` with `"Acme Industries Inc"`. That means a real company named
    literally **"The Group"** or **"Holdings Co"** normalizes to something empty or surprising —
    `importCompanies` skips empty keys and reports the line, which is the safe failure, but check the
    skip list on your first real import. Tested both directions in `crm/import.test.ts`.
15. **`domainOf()` is not a public-suffix parser.** `acme.co.uk` yields `acme.co.uk` (fine), but it
    has no PSL and will happily return `github.io`. It is a *dedupe hint*, never an identity.
16. **The free-mail exclusion set in `email/inbound.ts` is hand-maintained.** A reply from an owner's
    personal Gmail won't match by domain — it falls through to exact-email matching, and failing
    that, `alertInboundReply` fires with "no matching company". That's the intended graceful
    degradation, but expect to add domains.

### Quality assessment — what to keep, what to rewrite

**Keep as-is.** `db/index.ts` (49 lines that solve two real production footguns),
`runtime/ratelimit.ts` (the counter-table trick is the best idea in the source repo),
`email/resend.ts`'s never-throws contract and multi-secret verification, `crm/companies.ts`'s
normalize-then-UNIQUE pattern, `crm/revisit.ts`'s pure predicates. These are proven and tested.

**Good, but written blind.** The three UI files (~880 lines) are the ones I'd expect you to rework
most, not because they're wrong but because I don't know how the firm actually works. They're
deliberately plain server components with no client JS, so reworking them is editing markup, not
untangling state. The record page in particular is a reasonable guess at information hierarchy —
revisit control at the top, timeline on the right — and a guess is all it is.

**Mediocre, flagged.** `email/inbound.ts`'s MIME parsing is a hand-rolled subset (headers,
RFC-2047 encoded words, quoted-printable, first `text/plain` part). It worked in production for the
source app's traffic, but it is not a MIME library and it will meet a message it mangles. If inbound
matters more than as a notification path, use a real parser.

**Nothing here is a mess I'd hide.** The one thing I'd genuinely rewrite rather than adapt is the
source's `app/companies/page.tsx` data access — it loaded 1,000 profiles plus every outreach row and
reduced in JavaScript — and it is already rewritten as SQL aggregates in this packet.
