// REVISIT: the multi-year fuse.
//
// A "not right now" from an owner is the most valuable object in origination —
// it is a qualified lead with a delivery date attached. This module is the one
// piece of the system that must never silently fail, because its failure mode
// is indistinguishable from success: a revisit that never surfaces looks
// exactly like a revisit that isn't due yet.
//
// Distilled from four production implementations of this behaviour in the
// source app, which each solved it separately for one narrow case:
//   lib/pipeline/renewals.ts      330-day contract anniversary → resurface + alert
//   lib/pipeline/hold-expiry.ts   deadline lookahead → one reminder, best channel
//   lib/pipeline/outcome-check.ts day-7 follow-up, once per record ever
//   lib/pipeline/long-tail.ts     30-day re-touch
//
// Their common shape, kept here: a PURE due-predicate (unit-tested, no clock of
// its own), a date-window read, an idempotency marker so a re-run can't
// double-notify, and a best-effort notifier that can fail without losing the
// due state.
//
// TWO SURFACES, deliberately:
//   1. READ (listDueRevisits) — idempotent, no writes. Powers the work queue
//      UI. Safe to call on every page load, forever.
//   2. SWEEP (runRevisitSweep) — writes a timeline row, stamps surfaced_at,
//      emails a digest. Runs once a day from cron.
// The read never depends on the sweep having run. If the cron dies for a week,
// the queue is still correct — you just stop getting the emails. That
// separation is the whole reliability argument.

import { and, asc, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import { activity, company, contact, crmUser, deal } from "../db/schema";
import { onceEver } from "../runtime/ratelimit";
import { logAudit } from "./audit";

export type RevisitEntity = "company" | "contact" | "deal";

export type DueRevisit = {
  entity: RevisitEntity;
  /** Row id of the company/contact/deal carrying the revisit. */
  id: string;
  /** Company this rolls up to — always present, so every item is clickable
   *  through to one record page regardless of which table it came from. */
  companyId: string;
  companyName: string;
  /** Contact name or deal title; null for company-level revisits. */
  label: string | null;
  /** "YYYY-MM-DD". */
  revisitDate: string;
  note: string | null;
  userId: string | null;
  userEmail: string | null;
  surfacedAt: Date | null;
  /** Negative = overdue by N days. */
  daysUntil: number;
};

/** Today as "YYYY-MM-DD" in a given IANA timezone. The firm's working day, not
 *  UTC — a revisit set for the 3rd must not appear on the 2nd at 7pm local. */
export function todayInTz(tz: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the DATE column's text form.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** PURE. Is a revisit due as of `today`? Inclusive: due today counts as due.
 *  Both args are "YYYY-MM-DD"; lexicographic compare is correct for that form. */
export function isDue(revisitDate: string | null, today: string): boolean {
  if (!revisitDate) return false;
  return revisitDate <= today;
}

/** PURE. Whole days from `today` to `revisitDate` (negative = overdue). Parsed
 *  as UTC midnights so DST never shifts the count. */
export function daysUntil(revisitDate: string, today: string): number {
  const a = Date.parse(`${revisitDate}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((a - b) / 86_400_000);
}

/** PURE. Add days to a "YYYY-MM-DD", returning the same form. Used by snooze
 *  and by callers translating "6 months" into a date. */
export function addDays(dateStr: string, days: number): string {
  const t = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`addDays: bad date "${dateStr}"`);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/** PURE. Validate the DATE text form before it reaches Postgres — a bad string
 *  otherwise fails mid-statement with an opaque driver error (the source app
 *  had exactly this bug abort a whole sourcing run on one malformed date). */
export function isValidDateStr(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

// --- read side --------------------------------------------------------------

/**
 * Everything due on or before `today`, across all three record types, oldest
 * first. Read-only and idempotent.
 *
 * Three queries merged in memory rather than a SQL UNION: the due set is small
 * by nature (a working queue, not a table scan) and this keeps each query on
 * its own partial index. If a firm ever runs tens of thousands of overdue
 * items, replace with a UNION ALL view — noted in PACKET.md.
 */
export async function listDueRevisits(opts: {
  today: string;
  /** Only this banker's queue. Matches revisit_user_id, falling back to the
   *  record's owner when no explicit revisit owner was set. */
  userId?: string | null;
  /** Include items the sweep has already surfaced (default true — the queue
   *  shows outstanding work, not just new work). */
  includeSurfaced?: boolean;
  limit?: number;
}): Promise<DueRevisit[]> {
  const { today, userId = null, includeSurfaced = true, limit = 500 } = opts;
  // Due = a date is set and it is on/before today. When the sweep calls this it
  // additionally wants only items it hasn't already surfaced.
  const companyDue = includeSurfaced
    ? and(isNotNull(company.revisit_date), lte(company.revisit_date, today))
    : and(
        isNotNull(company.revisit_date),
        lte(company.revisit_date, today),
        isNull(company.revisit_surfaced_at)
      );
  const contactDue = includeSurfaced
    ? and(isNotNull(contact.revisit_date), lte(contact.revisit_date, today))
    : and(
        isNotNull(contact.revisit_date),
        lte(contact.revisit_date, today),
        isNull(contact.revisit_surfaced_at)
      );
  const dealDue = includeSurfaced
    ? and(isNotNull(deal.revisit_date), lte(deal.revisit_date, today))
    : and(
        isNotNull(deal.revisit_date),
        lte(deal.revisit_date, today),
        isNull(deal.revisit_surfaced_at)
      );

  const [companies, contacts, deals] = await Promise.all([
    db
      .select({
        id: company.id,
        companyId: company.id,
        companyName: company.name,
        revisitDate: company.revisit_date,
        note: company.revisit_note,
        userId: sql<string | null>`coalesce(${company.revisit_user_id}, ${company.owner_user_id})`,
        surfacedAt: company.revisit_surfaced_at,
      })
      .from(company)
      .where(and(companyDue, isNull(company.blocked_at)))
      .orderBy(asc(company.revisit_date))
      .limit(limit),
    db
      .select({
        id: contact.id,
        companyId: contact.company_id,
        companyName: company.name,
        label: contact.full_name,
        revisitDate: contact.revisit_date,
        note: contact.revisit_note,
        userId: sql<string | null>`coalesce(${contact.revisit_user_id}, ${company.owner_user_id})`,
        surfacedAt: contact.revisit_surfaced_at,
      })
      .from(contact)
      .innerJoin(company, eq(contact.company_id, company.id))
      .where(and(contactDue, isNull(company.blocked_at)))
      .orderBy(asc(contact.revisit_date))
      .limit(limit),
    db
      .select({
        id: deal.id,
        companyId: deal.company_id,
        companyName: company.name,
        label: deal.title,
        revisitDate: deal.revisit_date,
        note: deal.revisit_note,
        userId: sql<string | null>`coalesce(${deal.revisit_user_id}, ${deal.owner_user_id}, ${company.owner_user_id})`,
        surfacedAt: deal.revisit_surfaced_at,
      })
      .from(deal)
      .innerJoin(company, eq(deal.company_id, company.id))
      .where(and(dealDue, isNull(company.blocked_at)))
      .orderBy(asc(deal.revisit_date))
      .limit(limit),
  ]);

  // Resolve owner emails in one pass (the digest needs them; the UI shows them).
  const users = await db
    .select({ id: crmUser.id, email: crmUser.email })
    .from(crmUser)
    .where(isNull(crmUser.disabled_at));
  const emailOf = new Map(users.map((u) => [u.id, u.email]));

  const out: DueRevisit[] = [
    ...companies.map((r) => ({ entity: "company" as const, label: null, ...r })),
    ...contacts.map((r) => ({ entity: "contact" as const, ...r })),
    ...deals.map((r) => ({ entity: "deal" as const, ...r })),
  ]
    .filter((r) => !!r.revisitDate)
    .map((r) => ({
      entity: r.entity,
      id: r.id,
      companyId: r.companyId,
      companyName: r.companyName,
      label: r.label,
      revisitDate: r.revisitDate as string,
      note: r.note,
      userId: r.userId,
      userEmail: r.userId ? emailOf.get(r.userId) ?? null : null,
      surfacedAt: r.surfacedAt,
      daysUntil: daysUntil(r.revisitDate as string, today),
    }))
    .filter((r) => !userId || r.userId === userId);

  // Most overdue first — the queue should lead with what's been waiting longest.
  return out.sort((a, b) => a.revisitDate.localeCompare(b.revisitDate)).slice(0, limit);
}

/** Count only — for a nav badge. Cheap enough to call on every render. */
export async function countDueRevisits(today: string, userId?: string | null): Promise<number> {
  return (await listDueRevisits({ today, userId, limit: 1000 })).length;
}

// --- write side -------------------------------------------------------------

const TABLE = { company, contact, deal } as const;

/**
 * Set (or move) a revisit. Writes a timeline row so the fuse itself is part of
 * the record's history — "why is this coming back in 2028?" must be answerable
 * a year later. Clears `revisit_surfaced_at` so a moved date re-notifies.
 */
export async function setRevisit(o: {
  entity: RevisitEntity;
  id: string;
  /** "YYYY-MM-DD", or null to clear. */
  date: string | null;
  note?: string | null;
  userId?: string | null;
  actorUserId?: string | null;
  /** Company the record rolls up to. Required for the timeline row; pass it in
   *  rather than re-querying (the caller already has it on screen). */
  companyId: string;
}): Promise<void> {
  if (o.date !== null && !isValidDateStr(o.date)) {
    throw new Error(`setRevisit: revisit date must be YYYY-MM-DD, got "${o.date}"`);
  }
  const table = TABLE[o.entity];
  await db
    .update(table)
    .set({
      revisit_date: o.date,
      revisit_note: o.note ?? null,
      revisit_user_id: o.userId ?? null,
      revisit_surfaced_at: null,
      updated_at: new Date(),
    })
    .where(eq(table.id, o.id));

  await db
    .insert(activity)
    .values({
      company_id: o.companyId,
      contact_id: o.entity === "contact" ? o.id : null,
      deal_id: o.entity === "deal" ? o.id : null,
      kind: "note",
      subject: o.date ? `Revisit set for ${o.date}` : "Revisit cleared",
      body: o.note ?? null,
      actor_user_id: o.actorUserId ?? null,
      meta: { revisit: { entity: o.entity, date: o.date } },
    })
    .catch(() => null); // timeline write must never fail the state change

  await logAudit({
    actorUserId: o.actorUserId ?? null,
    action: "revisit.set",
    entity: o.entity,
    recordId: o.id,
    after: { revisit_date: o.date, revisit_note: o.note ?? null },
  });
}

/** Push a revisit out by N days from today (the "still not now" button). */
export async function snoozeRevisit(o: {
  entity: RevisitEntity;
  id: string;
  companyId: string;
  today: string;
  days: number;
  note?: string | null;
  actorUserId?: string | null;
  userId?: string | null;
}): Promise<string> {
  const next = addDays(o.today, o.days);
  await setRevisit({ ...o, date: next });
  return next;
}

/**
 * Mark a due revisit as handled: clears the fuse and logs the outcome. Separate
 * from setRevisit(null) so the timeline says "completed", not "cleared".
 */
export async function completeRevisit(o: {
  entity: RevisitEntity;
  id: string;
  companyId: string;
  outcome: string;
  actorUserId?: string | null;
}): Promise<void> {
  const table = TABLE[o.entity];
  await db
    .update(table)
    .set({
      revisit_date: null,
      revisit_note: null,
      revisit_surfaced_at: null,
      updated_at: new Date(),
    })
    .where(eq(table.id, o.id));
  await db
    .insert(activity)
    .values({
      company_id: o.companyId,
      contact_id: o.entity === "contact" ? o.id : null,
      deal_id: o.entity === "deal" ? o.id : null,
      kind: "note",
      subject: "Revisit completed",
      body: o.outcome,
      actor_user_id: o.actorUserId ?? null,
    })
    .catch(() => null);
  await logAudit({
    actorUserId: o.actorUserId ?? null,
    action: "revisit.complete",
    entity: o.entity,
    recordId: o.id,
    after: { outcome: o.outcome },
  });
}

// --- the sweep --------------------------------------------------------------

export type RevisitSweepSummary = {
  due: number;
  surfaced: number;
  digestsSent: number;
  skipped: number;
  log: string[];
};

/**
 * Daily sweep. For every newly-due revisit: write a `revisit_due` timeline row,
 * stamp `revisit_surfaced_at`, and (when a mailer is supplied) send each banker
 * ONE digest of their due items.
 *
 * Idempotency: a per-item marker keyed `revisit:<entity>:<id>:<date>` in
 * usage_counter with a far-future window, so re-running the cron — or running
 * it twice concurrently — surfaces each item exactly once. `revisit_surfaced_at`
 * is the human-visible mirror of that marker, not the guard itself (a column
 * check would race between two invocations; the marker insert cannot).
 *
 * `sendDigest` is injected rather than imported so this module has no email
 * dependency and stays unit-testable. Pass the wrapper from email/resend.ts.
 */
export async function runRevisitSweep(o: {
  today: string;
  apply?: boolean;
  sendDigest?: (to: string, items: DueRevisit[]) => Promise<void>;
}): Promise<RevisitSweepSummary> {
  const apply = o.apply ?? false;
  const log: string[] = [];
  const fresh = await listDueRevisits({ today: o.today, includeSurfaced: false });
  const summary: RevisitSweepSummary = {
    due: fresh.length,
    surfaced: 0,
    digestsSent: 0,
    skipped: 0,
    log,
  };
  if (!fresh.length) {
    log.push(`No newly-due revisits as of ${o.today}.`);
    return summary;
  }

  const claimed: DueRevisit[] = [];
  for (const item of fresh) {
    if (!apply) {
      log.push(`  DRY ${item.entity} ${item.companyName} — due ${item.revisitDate}`);
      claimed.push(item);
      continue;
    }
    const first = await onceEver(`revisit:${item.entity}:${item.id}:${item.revisitDate}`);
    if (!first) {
      summary.skipped++;
      continue; // another invocation already surfaced this one
    }
    const table = TABLE[item.entity];
    await db
      .update(table)
      .set({ revisit_surfaced_at: new Date(), updated_at: new Date() })
      .where(eq(table.id, item.id));
    await db
      .insert(activity)
      .values({
        company_id: item.companyId,
        contact_id: item.entity === "contact" ? item.id : null,
        deal_id: item.entity === "deal" ? item.id : null,
        kind: "revisit_due",
        subject: `Revisit due${item.label ? ` — ${item.label}` : ""}`,
        body: item.note,
        meta: { revisit: { entity: item.entity, date: item.revisitDate } },
      })
      .catch(() => null);
    summary.surfaced++;
    claimed.push(item);
    log.push(`  ✓ ${item.entity} ${item.companyName} — due ${item.revisitDate}`);
  }

  // One digest per banker. Unassigned items go to the fallback inbox so a
  // revisit with no owner is never silently orphaned.
  if (o.sendDigest && claimed.length) {
    const byEmail = new Map<string, DueRevisit[]>();
    const fallback = process.env.REVISIT_DIGEST_FALLBACK_EMAIL ?? null;
    for (const item of claimed) {
      const to = item.userEmail ?? fallback;
      if (!to) continue;
      byEmail.set(to, [...(byEmail.get(to) ?? []), item]);
    }
    for (const [to, items] of byEmail) {
      try {
        if (apply) await o.sendDigest(to, items);
        summary.digestsSent++;
      } catch (e) {
        // A failed digest must NOT roll back the surfacing — the queue UI is
        // the source of truth and already shows these. Log and move on.
        log.push(`  ! digest to ${to} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return summary;
}

/** Plain-text digest body. Kept here (not in the email module) because the
 *  wording is domain logic: overdue days and the original note are the two
 *  things that make a banker act. */
export function revisitDigestText(items: DueRevisit[], baseUrl: string): string {
  const lines = items.map((i) => {
    const overdue = i.daysUntil < 0 ? ` (${Math.abs(i.daysUntil)}d overdue)` : "";
    const what = i.label ? `${i.companyName} — ${i.label}` : i.companyName;
    const why = i.note ? `\n    "${i.note}"` : "";
    return `- ${what}${overdue}\n    ${baseUrl}/companies/${i.companyId}${why}`;
  });
  return (
    `${items.length} revisit${items.length === 1 ? "" : "s"} due:\n\n` +
    lines.join("\n\n") +
    `\n\nFull queue: ${baseUrl}/revisits\n`
  );
}
