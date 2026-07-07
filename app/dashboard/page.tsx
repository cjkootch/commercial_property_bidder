import Link from "next/link";
import { db } from "@/lib/db";
import { buyer, leadUnlock } from "@/lib/db/schema";
import { getDefaultCompany, listDashboard, type DashboardRow } from "@/lib/db/queries";
import { usd, titleCase } from "@/lib/format";
import { isGrassQualified, grassPercentLabel, MIN_GRASS_FRACTION } from "@/lib/sourcing/criteria";

export const dynamic = "force-dynamic";

// Pipeline order (build spec section 4).
const PIPELINE = [
  "sourced",
  "priced",
  "contacts_enriched",
  "proposal_ready",
  "outreach_drafted",
  "sent",
  "replied",
  "walkthrough_booked",
  "won",
  "lost",
] as const;

export default async function DashboardPage() {
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

  // Header metrics: total annual pipeline value, excluding lost.
  const live = rows.filter((r) => r.status !== "lost");
  const totalAnnual = live.reduce((s, r) => s + (r.annual_price ?? 0), 0);
  const needsReview = rows.filter((r) => r.needs_review).length;
  const grassQualified = rows.filter((r) => isGrassQualified(r.grass_fraction)).length;

  // Marketplace: lead-sale revenue, buyers, and credit liability.
  const unlocks = await db.select().from(leadUnlock);
  const buyers = await db.select().from(buyer);
  const leadRevenue = unlocks.reduce((s, u) => s + u.price_cents, 0) / 100;
  const paidUnlocks = unlocks.filter((u) => u.kind !== "free").length;
  const freeUnlocks = unlocks.length - paidUnlocks;
  const creditOutstanding = buyers.reduce((s, b) => s + b.credit_cents, 0) / 100;
  const alertsOn = buyers.filter((b) => b.notify).length;

  const byStatus = new Map<string, DashboardRow[]>();
  for (const r of rows) {
    const list = byStatus.get(r.status) ?? [];
    list.push(r);
    byStatus.set(r.status, list);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Pipeline</h1>
        <Link
          href="/properties/new"
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
        >
          + Add property
        </Link>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Metric label="Properties" value={String(rows.length)} />
        <Metric label="Annual pipeline" value={usd(totalAnnual, { cents: false })} />
        <Metric label={`Grass-qualified (≥${Math.round(MIN_GRASS_FRACTION * 100)}%)`} value={String(grassQualified)} />
        <Metric label="Needs review" value={String(needsReview)} accent={needsReview > 0} />
      </div>

      {/* Lead marketplace at a glance */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Lead marketplace
        </h2>
        <div className="grid grid-cols-5 gap-4">
          <Metric label="Lead revenue" value={`$${Math.round(leadRevenue).toLocaleString()}`} accent={leadRevenue > 0} />
          <Metric label="Paid unlocks" value={String(paidUnlocks)} />
          <Metric label="Free claims" value={String(freeUnlocks)} />
          <Metric label="Buyers (alerts on)" value={`${buyers.length} (${alertsOn})`} />
          <Metric label="Credit outstanding" value={`$${Math.round(creditOutstanding).toLocaleString()}`} accent={creditOutstanding > 0} />
        </div>
      </section>

      {rows.length === 0 ? (
        <EmptyState
          title="No properties yet"
          body="Add your first property to price a contract."
        />
      ) : (
        <div className="space-y-6">
          {PIPELINE.filter((s) => byStatus.has(s)).map((status) => (
            <section key={status}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                {titleCase(status)}{" "}
                <span className="text-gray-400">({byStatus.get(status)!.length})</span>
              </h2>
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Property</th>
                      <th className="px-4 py-2 font-medium">Lead</th>
                      <th className="px-4 py-2 font-medium">Type</th>
                      <th className="px-4 py-2 font-medium">Owner</th>
                      <th className="px-4 py-2 font-medium">Grass</th>
                      <th className="px-4 py-2 text-right font-medium">Monthly</th>
                      <th className="px-4 py-2 text-right font-medium">Annual</th>
                      <th className="px-4 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {byStatus
                      .get(status)!
                      .slice()
                      .sort((a, b) => b.lead_score - a.lead_score)
                      .map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5">
                          <Link href={`/properties/${r.id}`} className="font-medium text-brand hover:underline">
                            {r.name}
                          </Link>
                          {r.city ? <span className="ml-1 text-gray-400">· {r.city}</span> : null}
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
                        <td className="px-4 py-2.5 text-gray-600">{titleCase(r.icp_type)}</td>
                        <td className="px-4 py-2.5 text-gray-600">{r.owner_org ?? "—"}</td>
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
                        <td className="px-4 py-2.5 text-right tabular-nums">{usd(r.monthly_price)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{usd(r.annual_price)}</td>
                        <td className="px-4 py-2.5">
                          {r.needs_review ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                              Review
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
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

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center">
      <h2 className="text-lg font-medium text-gray-700">{title}</h2>
      <p className="mt-1 text-sm text-gray-500">{body}</p>
    </div>
  );
}
