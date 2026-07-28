// The activity timeline: one write path, one read path.
//
// The source app split this across three tables (lead_activity, email_send,
// sms_send) and merged them in the page component. That merge was where the bugs
// lived — most memorably a NULLS-FIRST ordering bug that made never-sent rows
// outrank real sends and mis-framed an automated reply. One table, one
// occurred_at ordering, no merge.

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { activity, contact, crmUser, type Activity } from "../db/schema";

export type ActivityKind =
  | "call"
  | "email_out"
  | "email_in"
  | "letter"
  | "meeting"
  | "note"
  | "stage_change"
  | "revisit_due"
  | "system";

/** Log anything that happened with a company. `occurredAt` defaults to now but
 *  is caller-settable so a call logged the next morning sorts to when it
 *  actually happened. */
export async function logActivity(o: {
  companyId: string;
  kind: ActivityKind;
  subject?: string | null;
  body?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  brandId?: string | null;
  actorUserId?: string | null;
  occurredAt?: Date;
  externalId?: string | null;
  emailAddress?: string | null;
  meta?: unknown;
}): Promise<string> {
  const [row] = await db
    .insert(activity)
    .values({
      company_id: o.companyId,
      contact_id: o.contactId ?? null,
      deal_id: o.dealId ?? null,
      brand_id: o.brandId ?? null,
      kind: o.kind,
      subject: o.subject ?? null,
      body: o.body ?? null,
      actor_user_id: o.actorUserId ?? null,
      occurred_at: o.occurredAt ?? new Date(),
      external_id: o.externalId ?? null,
      email_address: o.emailAddress ?? null,
      meta: (o.meta ?? null) as never,
    })
    .returning({ id: activity.id });
  return row.id;
}

export type TimelineEntry = Activity & {
  contactName: string | null;
  actorName: string | null;
};

/**
 * A company's full timeline, newest first — ONE indexed query
 * (activity_company_time_idx), with contact and actor names joined for display.
 */
export async function companyTimeline(
  companyId: string,
  opts: { limit?: number; kinds?: ActivityKind[] } = {}
): Promise<TimelineEntry[]> {
  const { limit = 200, kinds } = opts;
  const rows = await db
    .select({
      a: activity,
      contactName: contact.full_name,
      actorName: crmUser.name,
    })
    .from(activity)
    .leftJoin(contact, eq(activity.contact_id, contact.id))
    .leftJoin(crmUser, eq(activity.actor_user_id, crmUser.id))
    .where(
      kinds?.length
        ? and(eq(activity.company_id, companyId), inArray(activity.kind, kinds))
        : eq(activity.company_id, companyId)
    )
    .orderBy(desc(activity.occurred_at))
    .limit(limit);
  return rows.map((r) => ({ ...r.a, contactName: r.contactName, actorName: r.actorName }));
}

/** Engagement rollup for one company — counts, not a scan, so it's safe to call
 *  from a list view via companyEngagement() below. */
export type Engagement = {
  emailsOut: number;
  emailsIn: number;
  calls: number;
  letters: number;
  opens: number;
  clicks: number;
  bounced: boolean;
  lastTouchAt: Date | null;
  lastInboundAt: Date | null;
};

/**
 * Engagement for MANY companies in one aggregate query.
 *
 * Explicitly SQL-side because the source app's equivalent list view pulled 1,000
 * company rows plus EVERY outreach row into Node and reduced them in JavaScript.
 * That works at a few thousand rows and silently becomes the slowest page in the
 * app after that. Aggregate in Postgres; ship counts, not rows.
 */
export async function companyEngagement(companyIds: string[]): Promise<Map<string, Engagement>> {
  const out = new Map<string, Engagement>();
  if (!companyIds.length) return out;
  const rows = await db
    .select({
      companyId: activity.company_id,
      emailsOut: sql<number>`count(*) filter (where ${activity.kind} = 'email_out')::int`,
      emailsIn: sql<number>`count(*) filter (where ${activity.kind} = 'email_in')::int`,
      calls: sql<number>`count(*) filter (where ${activity.kind} = 'call')::int`,
      letters: sql<number>`count(*) filter (where ${activity.kind} = 'letter')::int`,
      opens: sql<number>`coalesce(sum(${activity.open_count}), 0)::int`,
      clicks: sql<number>`coalesce(sum(${activity.click_count}), 0)::int`,
      bounced: sql<boolean>`bool_or(${activity.bounced_at} is not null)`,
      lastTouchAt: sql<Date | null>`max(${activity.occurred_at})`,
      lastInboundAt: sql<Date | null>`max(${activity.occurred_at}) filter (where ${activity.kind} = 'email_in')`,
    })
    .from(activity)
    .where(inArray(activity.company_id, companyIds))
    .groupBy(activity.company_id);
  for (const r of rows) {
    out.set(r.companyId, {
      emailsOut: r.emailsOut,
      emailsIn: r.emailsIn,
      calls: r.calls,
      letters: r.letters,
      opens: r.opens,
      clicks: r.clicks,
      bounced: !!r.bounced,
      lastTouchAt: r.lastTouchAt ? new Date(r.lastTouchAt) : null,
      lastInboundAt: r.lastInboundAt ? new Date(r.lastInboundAt) : null,
    });
  }
  return out;
}

/** Recent activity across the whole firm — the "what's happening" feed. */
export async function recentActivity(sinceDays = 7, limit = 100) {
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  return db
    .select()
    .from(activity)
    .where(gte(activity.occurred_at, since))
    .orderBy(desc(activity.occurred_at))
    .limit(limit);
}
