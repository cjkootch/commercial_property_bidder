import Link from "next/link";
import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, chatMessage, leadUnlock, postcard, prospect } from "@/lib/db/schema";
import { getDefaultCompany, listDashboard, type DashboardRow } from "@/lib/db/queries";
import { usd, titleCase } from "@/lib/format";
import { isGrassQualified, grassPercentLabel } from "@/lib/sourcing/criteria";
import { leadMaxBuyers } from "@/lib/leads/availability";
import { TRADES, asTrade, type Trade } from "@/lib/leads/trades";
import { archiveProperty, unarchiveProperty } from "@/app/properties/actions";

// Operator dashboard, organized around the business as it actually runs now:
// sell leads to landscapers (inventory + revenue), keep them active (buyer
// activity + support), and feed the machine (production queue). Old-pipeline
// detail lives on each property page; measured/modelling properties can be
// archived out of the working lists without touching the ML training set.
export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { archived?: string };
}) {
  const co = await getDefaultCompany();
  if (!co) {
    return (
      <EmptyState
        title="No company yet"
        body="Run `npm run db:seed` to create the company, pricing config, and sample properties."
      />
    );
  }

  const rows = await listDashboard(co.id);
  const cap = leadMaxBuyers();

  const active = rows.filter((r) => !r.archived);
  const archived = rows.filter((r) => r.archived);
  const inventory = active
    .filter((r) => r.sellable)
    .sort((a, b) => (b.teaser_hi ?? b.annual_price ?? 0) - (a.teaser_hi ?? a.annual_price ?? 0));
  const production = active
    .filter((r) => !r.sellable)
    .sort((a, b) => b.lead_score - a.lead_score);
  const showArchived = searchParams.archived === "1";

  // --- Marketplace money ---
  const unlocks = await db.select().from(leadUnlock);
  const buyers = await db.select().from(buyer);
  const cards = await db.select().from(postcard).where(eq(postcard.status, "created"));
  const leadRevenue = unlocks.reduce((s, u) => s + u.price_cents, 0) / 100;
  // Per-trade spots per property — the cap is per trade now, and this powers
  // the expandable Spots column. (Counts all cycles; per-cycle nuance starts
  // mattering when renewals fire in ~a year.)
  const tradeSpots = new Map<string, Partial<Record<Trade, { n: number; excl: boolean }>>>();
  for (const u of unlocks) {
    const t = asTrade(u.trade);
    const e = tradeSpots.get(u.property_id) ?? {};
    const cell = e[t] ?? { n: 0, excl: false };
    cell.n++;
    if (u.kind === "exclusive") cell.excl = true;
    e[t] = cell;
    tradeSpots.set(u.property_id, e);
  }
  const postcardRevenue = cards.reduce((s, c) => s + c.price_cents, 0) / 100;
  const paidUnlocks = unlocks.filter((u) => u.kind !== "free").length;
  const freeUnlocks = unlocks.length - paidUnlocks;
  const creditOutstanding = buyers.reduce((s, b) => s + b.credit_cents, 0) / 100;
  const wonCount = unlocks.filter((u) => u.outreach_status === "won").length;

  // --- Buyer activity (the tool side of the business) ---
  const prospects = await db
    .select({ status: prospect.status, views: prospect.view_count })
    .from(prospect);
  const prospectViews = prospects.reduce((s, p) => s + (p.views ?? 0), 0);
  const [unreadRow] = await db
    .select({ n: count() })
    .from(chatMessage)
    .where(and(eq(chatMessage.sender, "buyer"), isNull(chatMessage.read_at)));
  const unread = unreadRow?.n ?? 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="text-2xl font-semibold">Marketplace</h1>
        <div className="flex items-center gap-3">
          <Link
            href={showArchived ? "/dashboard" : "/dashboard?archived=1"}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            {showArchived ? "Hide archived" : `Archived (${archived.length})`}
          </Link>
          <Link
            href="/properties/new"
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
          >
            + Add property
          </Link>
        </div>
      </div>

      {/* Money first. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
        <Metric label="Lead revenue" value={`$${Math.round(leadRevenue).toLocaleString()}`} accent={leadRevenue > 0} />
        <Metric label="Postcard revenue" value={`$${Math.round(postcardRevenue).toLocaleString()}`} />
        <Metric label="Paid unlocks" value={String(paidUnlocks)} />
        <Metric label="Free claims" value={String(freeUnlocks)} />
        <Metric label="Buyer contracts won" value={String(wonCount)} accent={wonCount > 0} />
        <Metric label="Credit outstanding" value={`$${Math.round(creditOutstanding).toLocaleString()}`} accent={creditOutstanding > 0} />
      </div>

      {/* Buyers using the tool = retention. */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Buyer activity
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Metric label="Buyers (alerts on)" value={`${buyers.length} (${buyers.filter((b) => b.notify).length})`} />
          <Metric label="Self-serve prospects" value={String(prospects.length)} />
          <Metric label="Quote-page opens" value={String(prospectViews)} />
          <MetricLink
            label="Unread messages"
            value={String(unread)}
            accent={unread > 0}
            href="/messages"
          />
        </div>
      </section>

      {/* The shop window: leads that are (or can be) for sale right now. */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Lead inventory <span className="text-gray-400">({inventory.length} open)</span>
        </h2>
        {inventory.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
            No sellable leads right now — run the pipeline to source and measure new permits.
          </p>
        ) : (
          <PropertyTable rows={inventory} cap={cap} kind="inventory" tradeSpots={tradeSpots} />
        )}
      </section>

      {/* The feeder: everything being prepared (or already used for modelling). */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Production queue <span className="text-gray-400">({production.length})</span>
        </h2>
        <p className="mb-2 text-xs text-gray-400">
          Sourced and measured properties that aren&apos;t marketplace leads. Archive anything
          you&apos;ve finished reviewing — its measurements keep training the model either way.
        </p>
        {production.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
            Nothing in production.
          </p>
        ) : (
          <PropertyTable rows={production} cap={cap} kind="production" />
        )}
      </section>

      {showArchived ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Archived <span className="text-gray-400">({archived.length})</span>
          </h2>
          {archived.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
              Nothing archived yet.
            </p>
          ) : (
            <PropertyTable rows={archived} cap={cap} kind="archived" />
          )}
        </section>
      ) : null}
    </div>
  );
}

function PropertyTable({
  rows,
  cap,
  kind,
  tradeSpots,
}: {
  rows: DashboardRow[];
  cap: number;
  kind: "inventory" | "production" | "archived";
  tradeSpots?: Map<string, Partial<Record<Trade, { n: number; excl: boolean }>>>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Property</th>
            {kind === "inventory" ? (
              <>
                <th className="px-4 py-2 font-medium">Buyer value</th>
                <th className="px-4 py-2 font-medium">Spots sold</th>
              </>
            ) : (
              <>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Annual</th>
              </>
            )}
            <th className="px-4 py-2 font-medium">Grass</th>
            <th className="px-4 py-2 font-medium">Lead</th>
            <th className="px-4 py-2 font-medium">Model</th>
            <th className="px-4 py-2 text-right font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="px-4 py-2.5">
                <Link href={`/properties/${r.id}`} className="font-medium text-brand hover:underline">
                  {r.name.replace(/ \(TABS [^)]+\)$/, "")}
                </Link>
                {r.city ? <span className="ml-1 text-gray-400">· {r.city}</span> : null}
                {r.lead_reasons.length ? (
                  <div className="mt-0.5 text-[11px] text-gray-400">
                    {r.lead_reasons.join(" · ")}
                  </div>
                ) : null}
              </td>
              {kind === "inventory" ? (
                <>
                  <td className="px-4 py-2.5 tabular-nums">
                    {r.teaser_lo != null
                      ? `${usd(r.teaser_lo, { cents: false })}–${usd(r.teaser_hi ?? r.teaser_lo, { cents: false })}/yr`
                      : r.annual_price != null
                        ? `${usd(r.annual_price, { cents: false })}/yr`
                        : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {/* Caps are per trade — collapsed shows the total, expand
                        for the six-trade breakdown. */}
                    <details>
                      <summary
                        className={`inline-flex cursor-pointer list-none items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          r.spots_sold > 0 ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {r.spots_sold} sold <span className="text-[9px]">\u25be</span>
                      </summary>
                      <div className="mt-1.5 flex w-40 flex-wrap gap-1">
                        {Object.values(TRADES).map((t) => {
                          const cell = tradeSpots?.get(r.id)?.[t.key];
                          return (
                            <span
                              key={t.key}
                              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                cell?.excl
                                  ? "bg-amber-100 text-amber-800"
                                  : cell?.n
                                    ? "bg-green-100 text-green-800"
                                    : "bg-gray-100 text-gray-400"
                              }`}
                            >
                              {t.label} {cell?.excl ? "EXCL" : `${cell?.n ?? 0}/${cap}`}
                            </span>
                          );
                        })}
                      </div>
                    </details>
                  </td>
                </>
              ) : (
                <>
                  <td className="px-4 py-2.5">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      {titleCase(r.status)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{usd(r.annual_price)}</td>
                </>
              )}
              <td className="px-4 py-2.5">
                {r.grass_fraction == null ? (
                  <span className="text-gray-400">—</span>
                ) : (
                  <span
                    className={
                      isGrassQualified(r.grass_fraction)
                        ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
                        : "rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600"
                    }
                  >
                    {grassPercentLabel(r.grass_fraction)}
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5">
                <span
                  title={r.lead_reasons.join(", ") || "no strong signals"}
                  className={
                    "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums " +
                    (r.lead_score >= 60
                      ? "bg-green-100 text-green-800"
                      : r.lead_score >= 40
                        ? "bg-amber-100 text-amber-800"
                        : "bg-gray-200 text-gray-600")
                  }
                >
                  {r.lead_score}
                </span>
              </td>
              <td className="px-4 py-2.5">
                {r.modelled ? (
                  <span
                    title="Has a human-verified measurement — trains the model (archiving never removes it)"
                    className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
                  >
                    Modelled
                  </span>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-right">
                {kind === "archived" ? (
                  <form action={unarchiveProperty.bind(null, r.id)}>
                    <button className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50">
                      Restore
                    </button>
                  </form>
                ) : (
                  <form action={archiveProperty.bind(null, r.id)}>
                    <button
                      title="Hide from working lists (training data is kept; reversible)"
                      className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                    >
                      Archive
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${accent ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-white"}`}>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent ? "text-amber-800" : "text-gray-900"}`}>
        {value}
      </div>
    </div>
  );
}

function MetricLink({
  label,
  value,
  href,
  accent,
}: {
  label: string;
  value: string;
  href: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-lg border p-4 transition hover:shadow-sm ${
        accent ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-white"
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-gray-500">{label} →</div>
      <div className={`mt-1 text-2xl font-semibold ${accent ? "text-amber-800" : "text-gray-900"}`}>
        {value}
      </div>
    </Link>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center">
      <h2 className="text-lg font-medium text-gray-700">{title}</h2>
      <p className="mt-1 text-sm text-gray-500">{body}</p>
    </div>
  );
}
