import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { bidRequest } from "@/lib/db/schema";
import { TRADES, asTrade } from "@/lib/leads/trades";
import { setBidRequestStatus } from "../bids/actions";

// Operator queue for owner-side bid requests: the routing engine is you (v1).
// Route = offer the job to matching buyers (roster, area alerts, or a call);
// close when handled.
export const dynamic = "force-dynamic";

const fmt = (d: Date) =>
  d.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function RequestsPage() {
  const rows = await db.select().from(bidRequest).orderBy(desc(bidRequest.created_at)).limit(200);
  const open = rows.filter((r) => r.status !== "closed");
  const closed = rows.filter((r) => r.status === "closed");

  const Row = ({ r }: { r: (typeof rows)[number] }) => (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      <div className="min-w-0">
        <div className="font-medium text-gray-900">
          {r.address}
          {r.city ? <span className="text-gray-400"> · {r.city}</span> : null}
          <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
            {TRADES[asTrade(r.trade)].label}
          </span>
          {r.status === "routed" ? (
            <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
              ROUTED
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 text-xs text-gray-500">
          {r.name} · <a href={`mailto:${r.email}`} className="text-brand hover:underline">{r.email}</a>
          {r.phone ? ` · ${r.phone}` : ""} · {fmt(r.created_at)}
        </div>
        {r.notes ? <div className="mt-1 text-xs text-gray-500">{r.notes}</div> : null}
      </div>
      <div className="flex shrink-0 gap-2">
        {r.status === "new" ? (
          <form action={setBidRequestStatus.bind(null, r.id, "routed")}>
            <button className="rounded-md bg-brand px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-dark">
              Mark routed
            </button>
          </form>
        ) : null}
        {r.status !== "closed" ? (
          <form action={setBidRequestStatus.bind(null, r.id, "closed")}>
            <button className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50">
              Close
            </button>
          </form>
        ) : (
          <form action={setBidRequestStatus.bind(null, r.id, "new")}>
            <button className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50">
              Reopen
            </button>
          </form>
        )}
      </div>
    </div>
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold">Bid requests</h1>
      <p className="mt-1 text-sm text-gray-500">
        Property owners asking for competing bids (from /bids). Route each to matching buyers —
        your roster is the supply.
      </p>

      <div className="mt-6 divide-y divide-gray-50 rounded-xl border border-gray-200 bg-white">
        {open.length ? (
          open.map((r) => <Row key={r.id} r={r} />)
        ) : (
          <p className="px-4 py-8 text-center text-sm text-gray-400">
            No open requests. Owners land here from the &quot;get competing bids&quot; page.
          </p>
        )}
      </div>

      {closed.length ? (
        <>
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Closed ({closed.length})
          </h2>
          <div className="mt-2 divide-y divide-gray-50 rounded-xl border border-gray-200 bg-white opacity-70">
            {closed.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
