# Multi-number model for prospect companies (post-launch fast-follow)

**Status:** planned fast-follow. Deferred deliberately (2026-07-13) so Monday's
first live SMS run ships on the verified single-phone model and its real
send/bounce data can shape the ranking. Do NOT start before we have that data.

## Why

`prospect_company.phone` is a single slot. Every source writes it and
overwrites the last: the website scrape (business main line), the cell-first
Apollo reveal (owner mobile), and bounce recovery all compete for one column.
That overwrite model is the root cause of the churn we've been patching:

- A recovered owner-cell is silently reverted the next time a weekly re-source
  scrapes the main line.
- The line-type / cell-lookup / recovery caches describe a *specific* number,
  so an overwrite makes them stale — the entire `IS DISTINCT FROM` reset in
  `lib/leads/companies.ts` (PR #226) exists only to paper over this.

Storing every number we learn — instead of overwriting — makes the whole class
of bug structurally impossible.

## Design

New child table `prospect_phone`:

| column | notes |
|---|---|
| `id` | uuid pk |
| `company_id` | FK → prospect_company, `on delete cascade` |
| `phone` | E.164; unique per `(company_id, phone)` |
| `source` | `scrape` \| `apollo` \| `recovery` |
| `line_type` | Twilio Lookup verdict for THIS number (nullable = unscreened) |
| `line_type_checked_at` | |
| `status` | `active` \| `opted_out` \| `bounced` |
| `first_seen` / `last_seen` | provenance |

The company's textable number becomes a **derived selection**, not a stored
slot: `bestTextableNumber(company)` = the highest-ranked `active` phone —
`mobile` > `voip` > `unknown`, excluding `landline` / `tollFree` / `opted_out` /
`bounced`.

### What each existing piece becomes

- **Screen** (`lib/sms/screen.ts`): screens a `prospect_phone` row, not the
  company. `line_type` lives on the number where it belongs.
- **Cell-first** (`lib/sms/cell.ts`): the Apollo mobile reveal *inserts* an
  `apollo`-sourced row (or upserts its line_type) — it no longer overwrites.
- **Recovery** (`lib/sms/recover.ts`): a bounce marks that phone `bounced`;
  next run auto-selects the next-best number with **no re-scrape and no Apollo
  credit** unless the set is exhausted.
- **Queue** (`lib/sms/queue.ts` `suggestedTexts`): join to the best active
  textable number per company; drop companies with none.
- **Upsert** (`lib/leads/companies.ts`): a scraped number becomes an insert of
  a `scrape` row (idempotent on the unique key) — the `IS DISTINCT FROM` cache
  reset is **deleted** (no longer needed).
- **Opt-out webhook** (`app/api/webhooks/twilio/route.ts`): a STOP marks the
  matching `prospect_phone` row `opted_out` (today's opt-out ledger by phone
  still holds as the cross-company backstop).

### Migration / backfill

1. Create `prospect_phone`.
2. Backfill one `active` row per existing `prospect_company.phone`, carrying its
   current `line_type` / `line_type_checked_at`, `source='scrape'`.
3. Keep `prospect_company.phone` for one release as a mirror of the selected
   best number (so display paths — `/companies`, inbox — keep working), then
   retire it once all readers move to `bestTextableNumber`.

### Blast radius

~18 files reference `prospect_company.phone`; most are display-only. The real
work is the ~6-file SMS selection path + the webhook opt-out mapping + the
backfill. Retirable afterward: the PR #226 cache-invalidation block, and the
per-company `line_type` / `cell_lookup_at` / `phone_recovery_at` columns move to
the phone rows.

## Data to gather from Monday's launch first (this shapes the ranking)

- **Cell-first hit rate:** of non-mobile candidates, how often does the Apollo
  reveal produce a mobile? High → the multi-number fallback is marginal polish;
  low → it's high-value.
- **Bounce rate by line_type:** confirms whether VoIP/unknown are worth keeping
  textable and where fallback matters.
- **Numbers-per-company distribution:** how often do we actually hold >1 number?
  If rarely, a lighter `text[]`/JSONB column may beat a full child table.

Report those from `sms_send` + the line-type columns after the first week, then
build the version the data argues for.
