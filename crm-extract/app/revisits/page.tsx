// THE REVISIT QUEUE — the screen the whole system exists to produce.
//
// Design rules, learned from the source app's operator surfaces:
//  - It reads from listDueRevisits(), which is idempotent and does not depend on
//    the cron having run. If the sweep dies, this page is still correct. The
//    email digest is a convenience; THIS is the source of truth.
//  - Most overdue first. A queue that leads with today's items lets the oldest
//    rot at the bottom.
//  - The original note is shown verbatim on every row. A banker re-entering a
//    conversation after 18 months needs the reason, not just the name — a bare
//    company list gets ignored, which is how a reminder system quietly fails.
//  - Every row has the two actions that resolve it inline: snooze (still not now)
//    and done. No drill-down required to clear the queue.
//
// Place at app/revisits/page.tsx.

import Link from "next/link";
import { currentUser } from "../../auth/session";
import { listDueRevisits, todayInTz, type DueRevisit } from "../../crm/revisit";
import { completeRevisitAction, snoozeRevisitAction } from "./actions";

export const dynamic = "force-dynamic";

const TZ = process.env.CRM_TIMEZONE || "America/New_York";

function OverdueBadge({ days }: { days: number }) {
  if (days > 0) return <span className="text-xs text-gray-400">in {days}d</span>;
  if (days === 0)
    return (
      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800">
        TODAY
      </span>
    );
  const overdue = Math.abs(days);
  const hot = overdue >= 14;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
        hot ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
      }`}
    >
      {overdue}d OVERDUE
    </span>
  );
}

function Row({ item, today }: { item: DueRevisit; today: string }) {
  const entityLabel =
    item.entity === "company" ? "Company" : item.entity === "contact" ? "Contact" : "Deal";
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/companies/${item.companyId}`}
            className="font-medium text-gray-900 hover:underline"
          >
            {item.companyName}
          </Link>
          {item.label ? <span className="text-sm text-gray-500">· {item.label}</span> : null}
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            {entityLabel}
          </span>
          <OverdueBadge days={item.daysUntil} />
        </div>
        {/* The reason, verbatim — this is what makes the row actionable. */}
        {item.note ? (
          <p className="mt-1 max-w-2xl text-sm italic text-gray-600">&ldquo;{item.note}&rdquo;</p>
        ) : (
          <p className="mt-1 text-sm text-gray-400">No note recorded.</p>
        )}
        <p className="mt-1 text-xs text-gray-400">
          Scheduled {item.revisitDate}
          {item.userEmail ? ` · ${item.userEmail}` : " · unassigned"}
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {[
          { label: "+1w", days: 7 },
          { label: "+1m", days: 30 },
          { label: "+3m", days: 91 },
          { label: "+1y", days: 365 },
        ].map((s) => (
          <form key={s.days} action={snoozeRevisitAction}>
            <input type="hidden" name="entity" value={item.entity} />
            <input type="hidden" name="id" value={item.id} />
            <input type="hidden" name="companyId" value={item.companyId} />
            <input type="hidden" name="today" value={today} />
            <input type="hidden" name="days" value={s.days} />
            <button
              className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
              title={`Push out ${s.days} days`}
            >
              {s.label}
            </button>
          </form>
        ))}
        <form action={completeRevisitAction} className="flex items-center gap-1">
          <input type="hidden" name="entity" value={item.entity} />
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="companyId" value={item.companyId} />
          <input
            name="outcome"
            placeholder="Outcome…"
            required
            className="w-28 rounded-md border border-gray-300 px-2 py-1 text-xs"
          />
          <button className="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-gray-700">
            Done
          </button>
        </form>
      </div>
    </li>
  );
}

export default async function RevisitsPage({
  searchParams,
}: {
  searchParams?: { mine?: string };
}) {
  const user = await currentUser();
  const today = todayInTz(TZ);
  const mine = searchParams?.mine === "1";
  const items = await listDueRevisits({
    today,
    userId: mine ? user?.id ?? null : null,
  });

  const overdue = items.filter((i) => i.daysUntil < 0);
  const dueToday = items.filter((i) => i.daysUntil === 0);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Revisits due</h1>
          <p className="mt-1 text-sm text-gray-500">
            {items.length === 0
              ? "Nothing due. Every fuse is still burning."
              : `${items.length} due — ${overdue.length} overdue, ${dueToday.length} today.`}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link
            href="/revisits"
            className={`rounded-full px-3 py-1.5 font-semibold ${
              !mine ? "bg-gray-900 text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            Everyone
          </Link>
          <Link
            href="/revisits?mine=1"
            className={`rounded-full px-3 py-1.5 font-semibold ${
              mine ? "bg-gray-900 text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            Mine
          </Link>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-gray-200 bg-white">
        {items.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-gray-400">
            No revisits due as of {today}.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {items.map((i) => (
              <Row key={`${i.entity}:${i.id}`} item={i} today={today} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
