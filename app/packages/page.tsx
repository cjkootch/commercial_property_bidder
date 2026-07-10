import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { residentialLead, residentialPackage, residentialUnlock } from "@/lib/db/schema";
import type { PackageTeaser } from "@/lib/residential/teaser";
import { setPackagePrice, setPackageStatus } from "./actions";

// Operator review desk for residential packages: the weekly autopilot lands
// drafts here; nothing goes on sale until the publish click.
export const dynamic = "force-dynamic";

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;
const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-amber-50 text-amber-700 border-amber-200",
  published: "bg-green-50 text-green-700 border-green-200",
  sold_out: "bg-gray-100 text-gray-600 border-gray-200",
  archived: "bg-gray-50 text-gray-400 border-gray-200",
};

export default async function PackagesPage() {
  const packages = await db
    .select()
    .from(residentialPackage)
    .orderBy(desc(residentialPackage.created_at));

  const sales = await db
    .select({
      pkg: residentialUnlock.residential_package_id,
      count: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(${residentialUnlock.price_cents}), 0)::int`,
    })
    .from(residentialUnlock)
    .groupBy(residentialUnlock.residential_package_id);
  const salesByPkg = new Map(sales.map((s) => [s.pkg, s]));

  const [poolRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(residentialLead)
    .where(sql`${residentialLead.status} in ('sourced', 'qualified')`);
  const unpackaged = poolRow?.count ?? 0;

  const active = packages.filter((p) => p.status !== "archived");
  const archived = packages.filter((p) => p.status === "archived");
  const totalRevenue = sales.reduce((a, s) => a + s.revenue, 0);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Residential packages</h1>
          <p className="mt-1 text-sm text-gray-500">
            The weekly cron sources recent home sales and drafts these bundles — publish puts one
            on sale at <span className="font-medium">/buyers/residential</span>.
          </p>
        </div>
        <div className="flex gap-6 text-sm">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Unpackaged leads</div>
            <div className="text-lg font-bold text-gray-900">{unpackaged}</div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Sales</div>
            <div className="text-lg font-bold text-gray-900">
              {sales.reduce((a, s) => a + s.count, 0)} · {usd(totalRevenue)}
            </div>
          </div>
        </div>
      </div>

      {active.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
          No packages yet — the residential cron runs Mondays, or trigger{" "}
          <code className="rounded bg-gray-100 px-1">/api/cron/residential</code> manually.
        </div>
      ) : (
        <div className="space-y-4">
          {active.map((pkg) => {
            const teaser = pkg.signal_summary as PackageTeaser | null;
            const sale = salesByPkg.get(pkg.id);
            return (
              <div key={pkg.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-gray-900">{pkg.name}</h2>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[pkg.status] ?? ""}`}
                      >
                        {pkg.status.replace("_", " ")}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-gray-500">
                      {pkg.geography_label ?? pkg.zip ?? "—"} · {pkg.lead_count} addresses · drafted{" "}
                      {fmtDate(pkg.created_at)}
                      {sale ? (
                        <span className="font-medium text-gray-700">
                          {" "}
                          · {sale.count} sale{sale.count === 1 ? "" : "s"} ({usd(sale.revenue)})
                        </span>
                      ) : null}
                    </p>
                    {teaser ? (
                      <p className="mt-1 text-xs text-gray-400">
                        {Object.entries(teaser.signalCounts)
                          .map(([t, c]) => `${t.replace(/_/g, " ")} ×${c}`)
                          .join(" · ")}
                        {teaser.zips.length ? ` · ZIPs ${teaser.zips.join(", ")}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={setPackagePrice} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={pkg.id} />
                      <span className="text-sm text-gray-400">$</span>
                      <input
                        name="usd"
                        type="number"
                        min={1}
                        max={5000}
                        defaultValue={Math.round(pkg.price_cents / 100)}
                        className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
                      />
                      <button className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">
                        Set price
                      </button>
                    </form>
                    {pkg.status === "draft" || pkg.status === "sold_out" ? (
                      <form action={setPackageStatus}>
                        <input type="hidden" name="id" value={pkg.id} />
                        <input type="hidden" name="status" value="published" />
                        <button className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90">
                          {pkg.status === "draft" ? "Publish" : "Republish"}
                        </button>
                      </form>
                    ) : null}
                    {pkg.status === "published" ? (
                      <>
                        <form action={setPackageStatus}>
                          <input type="hidden" name="id" value={pkg.id} />
                          <input type="hidden" name="status" value="sold_out" />
                          <button className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                            Mark sold out
                          </button>
                        </form>
                        <form action={setPackageStatus}>
                          <input type="hidden" name="id" value={pkg.id} />
                          <input type="hidden" name="status" value="draft" />
                          <button className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                            Unpublish
                          </button>
                        </form>
                      </>
                    ) : null}
                    <form action={setPackageStatus}>
                      <input type="hidden" name="id" value={pkg.id} />
                      <input type="hidden" name="status" value="archived" />
                      <button className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                        Archive
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {archived.length > 0 ? (
        <p className="mt-6 text-xs text-gray-400">
          {archived.length} archived package{archived.length === 1 ? "" : "s"} hidden. Buyers who
          purchased an archived package keep their report (the dossier is snapshotted on the
          unlock).
        </p>
      ) : null}
    </div>
  );
}
