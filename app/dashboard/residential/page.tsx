import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { residentialPackage } from "@/lib/db/schema";
import { getDefaultCompany } from "@/lib/db/queries";
import { usd, titleCase } from "@/lib/format";
import type { PackageTeaser } from "@/lib/residential/teaser";

export const dynamic = "force-dynamic";

export default async function ResidentialOperatorDashboard() {
  const co = await getDefaultCompany();
  if (!co) return <div>No company found.</div>;

  const packages = await db
    .select()
    .from(residentialPackage)
    .where(eq(residentialPackage.company_id, co.id))
    .orderBy(desc(residentialPackage.created_at));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Residential Packages</h1>
          <p className="text-sm text-gray-500">Manage residential lead opportunity reports.</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Metric label="Total Packages" value={String(packages.length)} />
        <Metric
          label="Drafts"
          value={String(packages.filter(p => p.status === "draft").length)}
        />
        <Metric
          label="Published"
          value={String(packages.filter(p => p.status === "published").length)}
        />
        <Metric
          label="Total Leads"
          value={String(packages.reduce((s, p) => s + p.lead_count, 0))}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Package Name</th>
              <th className="px-4 py-2 font-medium">Geography</th>
              <th className="px-4 py-2 text-right font-medium">Leads</th>
              <th className="px-4 py-2 font-medium">Strongest Signal</th>
              <th className="px-4 py-2 text-right font-medium">Price</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {packages.map((pkg) => {
              const teaser = pkg.signal_summary as PackageTeaser | null;
              return (
                <tr key={pkg.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{pkg.name}</td>
                  <td className="px-4 py-2.5 text-gray-600">{pkg.geography_label}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{pkg.lead_count}</td>
                  <td className="px-4 py-2.5">
                    {teaser?.strongestSignal ? (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                        {titleCase(teaser.strongestSignal)}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{usd(pkg.price_cents / 100, { cents: false })}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      pkg.status === "published" ? "bg-green-100 text-green-800" :
                      pkg.status === "draft" ? "bg-gray-100 text-gray-800" :
                      "bg-amber-100 text-amber-800"
                    }`}>
                      {titleCase(pkg.status)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">
                    {pkg.created_at.toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
            {packages.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-500 italic">
                  No residential packages created yet. Run `npm run residential:package`.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}
