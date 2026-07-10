import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, residentialPackage, residentialUnlock } from "@/lib/db/schema";
import { getDefaultCompany } from "@/lib/db/queries";
import { currentBuyerId } from "@/app/buyers/actions";
import { buildResidentialDossier, type ResidentialDossier } from "@/lib/residential/dossier";
import { Logo } from "@/components/Logo";

export const dynamic = "force-dynamic";

const fmtMoney = (n: number | null) => (n ? `$${Math.round(n).toLocaleString()}` : "—");
const fmtSignal = (s: string) => s.replace(/_/g, " ");

export default async function ResidentialReport({ params }: { params: { id: string } }) {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const [me] = await db.select().from(buyer).where(eq(buyer.id, buyerId!)).limit(1);
  if (!me) redirect("/buyers/login");

  const [unlock] = await db
    .select()
    .from(residentialUnlock)
    .where(
      and(
        eq(residentialUnlock.residential_package_id, params.id),
        eq(residentialUnlock.buyer_id, me.id)
      )
    )
    .limit(1);
  if (!unlock) redirect("/buyers/residential");

  const [pkg] = await db
    .select()
    .from(residentialPackage)
    .where(eq(residentialPackage.id, params.id))
    .limit(1);

  // Self-heal: if the webhook's dossier build failed, rebuild and persist now
  // — the buyer paid, the report must render.
  let dossier = unlock!.dossier as ResidentialDossier | null;
  if (!dossier?.leads?.length) {
    dossier = await buildResidentialDossier(params.id).catch(() => null);
    if (dossier?.leads?.length) {
      await db
        .update(residentialUnlock)
        .set({ dossier, updated_at: new Date() })
        .where(eq(residentialUnlock.id, unlock!.id));
    }
  }

  const co = await getDefaultCompany();
  const brand = co?.name ?? "Greenkeep";
  const purchasedAt = unlock!.created_at.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Chicago",
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Logo name={brand} />
            <span className="text-gray-300">/</span>
            <span className="text-sm font-medium text-gray-600">Residential Report</span>
          </div>
          <Link href="/buyers/residential" className="text-sm text-gray-500 hover:text-gray-800">
            All reports
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{pkg?.name ?? "Residential report"}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {pkg?.geography_label ? `${pkg.geography_label} · ` : ""}
              Purchased {purchasedAt} · {dossier?.leads.length ?? 0} addresses
            </p>
          </div>
          <a
            href={`/buyers/residential/${params.id}/csv`}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand/90"
          >
            Download CSV
          </a>
        </div>

        {!dossier?.leads?.length ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
            <h3 className="text-lg font-medium text-gray-900">Report is being prepared</h3>
            <p className="mt-2 text-gray-500">
              Your purchase is confirmed. Refresh in a minute — if this persists, message us from
              your dashboard and we&apos;ll sort it immediately.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                <tr>
                  <th className="px-4 py-3">Address</th>
                  <th className="px-4 py-3">City</th>
                  <th className="px-4 py-3">ZIP</th>
                  <th className="px-4 py-3">Subdivision</th>
                  <th className="px-4 py-3">Signal</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Est. value</th>
                  <th className="px-4 py-3 text-right">Lot (sqft)</th>
                  <th className="px-4 py-3 text-right">Built</th>
                  <th className="px-4 py-3 text-right">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {dossier.leads.map((l, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{l.address ?? "—"}</td>
                    <td className="px-4 py-2.5 text-gray-600">{l.city ?? "—"}</td>
                    <td className="px-4 py-2.5 text-gray-600">{l.zip ?? "—"}</td>
                    <td className="px-4 py-2.5 text-gray-600">{l.subdivision ?? "—"}</td>
                    <td className="px-4 py-2.5 capitalize text-gray-600">{fmtSignal(l.signal_type)}</td>
                    <td className="px-4 py-2.5 text-gray-600">{l.signal_date ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{fmtMoney(l.estimated_home_value)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">
                      {l.lot_size_sqft ? Math.round(l.lot_size_sqft).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{l.year_built ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{l.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-6 text-xs text-gray-500">
          Signals come from county deed records. Score ranks each address by signal strength and
          record confidence — start at the top. Addresses are for your own outreach (mail, door
          hangers, canvassing); please market respectfully.
        </p>
      </main>
    </div>
  );
}
