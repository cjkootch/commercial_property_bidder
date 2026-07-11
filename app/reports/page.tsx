import Link from "next/link";
import { getReportData, snapshotMarkdown } from "@/lib/reports/data";
import { EngagementChart } from "@/components/reports/EngagementChart";
import { FunnelChart } from "@/components/reports/FunnelChart";
import { CopySnapshot } from "@/components/reports/CopySnapshot";

// GA-style operator analytics: KPI tiles with period-over-period deltas, the
// daily engagement chart, the acquisition funnel, and trade/metro breakdowns.
// /dashboard stays the working list (inventory + queue); THIS page answers
// "is the machine working, and what changed?"
export const dynamic = "force-dynamic";

const RANGES = [7, 14, 28, 90] as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { days?: string };
}) {
  const parsed = Number(searchParams.days);
  const days = (RANGES as readonly number[]).includes(parsed) ? parsed : 28;
  const data = await getReportData(days);
  const md = snapshotMarkdown(data);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Email engagement and acquisition, all channels · vs previous {days} days
          </p>
        </div>
        <div className="flex items-center gap-3">
          <CopySnapshot markdown={md} />
          <div className="flex overflow-hidden rounded-md border border-gray-300 text-xs font-semibold">
            {RANGES.map((r) => (
              <Link
                key={r}
                href={`/reports?days=${r}`}
                className={
                  r === days
                    ? "bg-brand px-3 py-1.5 text-white"
                    : "bg-white px-3 py-1.5 text-gray-600 hover:bg-gray-50"
                }
              >
                {r}d
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* KPI tiles with deltas vs the previous period. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {data.kpis.map((k) => (
          <div key={k.key} className="rounded-lg border border-gray-200 bg-white p-4" title={k.help}>
            <div className="text-xs uppercase tracking-wide text-gray-500">{k.label}</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">{k.value}</div>
            {k.delta != null ? (
              <div
                className={`mt-0.5 text-xs font-medium ${
                  k.delta > 0 ? "text-green-700" : k.delta < 0 ? "text-red-700" : "text-gray-400"
                }`}
              >
                {k.delta > 0 ? "▲" : k.delta < 0 ? "▼" : "—"} {Math.abs(k.delta)}
                {k.key.endsWith("rate") ? "pt" : "%"} vs prev
              </div>
            ) : (
              <div className="mt-0.5 text-xs text-gray-300">no baseline</div>
            )}
          </div>
        ))}
      </div>

      {/* Chart + funnel. */}
      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-lg border border-gray-200 bg-white p-4 xl:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">
            {data.weekly ? "Weekly" : "Daily"} email engagement
          </h2>
          <EngagementChart buckets={data.buckets} />
        </section>
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Acquisition funnel</h2>
          <FunnelChart stages={data.funnel} />
        </section>
      </div>

      {/* Breakdowns. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">By trade</h2>
          {data.byTrade.length === 0 ? (
            <p className="text-sm text-gray-400">No campaign sends in this period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="pb-2 font-medium">Trade</th>
                  <th className="pb-2 text-right font-medium">Sends</th>
                  <th className="pb-2 text-right font-medium">Open %</th>
                  <th className="pb-2 text-right font-medium">Click %</th>
                  <th className="pb-2 text-right font-medium">Claims</th>
                  <th className="pb-2 text-right font-medium">Signups</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.byTrade.map((t) => (
                  <tr key={t.key}>
                    <td className="py-1.5 text-gray-700">{t.label}</td>
                    <td className="py-1.5 text-right tabular-nums">{t.sends}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {t.sends ? Math.round((t.opens / t.sends) * 100) : 0}%
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {t.sends ? Math.round((t.clicks / t.sends) * 100) : 0}%
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{t.claims}</td>
                    <td className="py-1.5 text-right tabular-nums">{t.signups}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">By metro</h2>
          {data.byMetro.length === 0 ? (
            <p className="text-sm text-gray-400">No campaign sends in this period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="pb-2 font-medium">Metro</th>
                  <th className="pb-2 text-right font-medium">Sends</th>
                  <th className="pb-2 text-right font-medium">Opened</th>
                  <th className="pb-2 text-right font-medium">Open %</th>
                  <th className="pb-2 text-right font-medium">Clicked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.byMetro.map((m) => (
                  <tr key={m.key}>
                    <td className="py-1.5 text-gray-700">{m.label}</td>
                    <td className="py-1.5 text-right tabular-nums">{m.sends}</td>
                    <td className="py-1.5 text-right tabular-nums">{m.opens}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {m.sends ? Math.round((m.opens / m.sends) * 100) : 0}%
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{m.clicks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* Autopilot + milestones. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Demand autopilot</h2>
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                data.autopilot.enabled ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
              }`}
            >
              {data.autopilot.enabled ? "● Running" : "● Off"}
            </span>
            <span className="text-sm text-gray-600">
              <span className="font-semibold tabular-nums">{data.autopilot.sentToday}</span> /{" "}
              {data.autopilot.cap} sends used today
            </span>
          </div>
          <div className="mt-3 h-2 rounded-full bg-gray-100">
            <div
              className="h-2 rounded-full bg-brand"
              style={{
                width: `${Math.min(100, (data.autopilot.sentToday / data.autopilot.cap) * 100)}%`,
              }}
            />
          </div>
          <p className="mt-2 text-xs text-gray-400">
            3 runs per business day rotate all 11 trades. Kill switch: DEMAND_AUTOPILOT=0 in Vercel.
          </p>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Milestones</h2>
          {data.timeline.length === 0 ? (
            <p className="text-sm text-gray-400">No launch events yet.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {data.timeline.map((e, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 tabular-nums text-gray-400">{e.date}</span>
                  <span className="text-gray-700">{e.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
