import Link from "next/link";
import { db } from "@/lib/db";
import { residentialMailCampaign, residentialPackage } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { usd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ResidentialMailDashboard() {
  const campaigns = await db.query.residentialMailCampaign.findMany({
    orderBy: [desc(residentialMailCampaign.created_at)],
  });

  // Manual join if relations aren't configured in the schema file (which they aren't yet)
  const campaignsWithPackage = await Promise.all(
    campaigns.map(async (c) => {
      const pkg = await db.query.residentialPackage.findFirst({
        where: eq(residentialPackage.id, c.residential_package_id),
      });
      return { ...c, pkgName: pkg?.name || "Unknown Package" };
    })
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Residential Mail Campaigns</h1>
        <div className="text-sm text-gray-500">
          Foundation for Lob Fulfillment
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Campaign Name</th>
              <th className="px-4 py-2 font-medium">Package</th>
              <th className="px-4 py-2 font-medium">Format</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Recipients</th>
              <th className="px-4 py-2 text-right font-medium">Client Price</th>
              <th className="px-4 py-2 font-medium">Created</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {campaignsWithPackage.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  No mail campaigns yet. Create one using <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">npm run residential:lob:draft</code>
                </td>
              </tr>
            ) : (
              campaignsWithPackage.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">
                    {c.name}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{c.pkgName}</td>
                  <td className="px-4 py-2.5 text-gray-600 uppercase">
                    {c.mail_format.replace("_", " ")}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-600">
                    {c.mailpiece_count}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-900">
                    {usd(c.client_price_cents ? c.client_price_cents / 100 : 0)}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">
                    {new Date(c.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      href={`/dashboard/residential/mail/${c.id}`}
                      className="text-brand hover:underline font-medium"
                    >
                      View Details
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700",
    proof_ready: "bg-blue-100 text-blue-700",
    approved: "bg-green-100 text-green-700",
    submitted: "bg-indigo-100 text-indigo-700",
    mailed: "bg-purple-100 text-purple-700",
    completed: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-100 text-red-700",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        colors[status] || "bg-gray-100 text-gray-700"
      }`}
    >
      {status.replace("_", " ")}
    </span>
  );
}
