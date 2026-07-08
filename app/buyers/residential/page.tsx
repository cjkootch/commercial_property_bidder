import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, residentialPackage } from "@/lib/db/schema";
import { getDefaultCompany } from "@/lib/db/queries";
import { currentBuyerId } from "@/app/buyers/actions";
import { Logo } from "@/components/Logo";
import type { PackageTeaser } from "@/lib/residential/teaser";
import { usd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ResidentialMarketplace() {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const [me] = await db.select().from(buyer).where(eq(buyer.id, buyerId!)).limit(1);
  if (!me) redirect("/buyers/login");

  const co = await getDefaultCompany();
  const brand = co?.name ?? "Greenkeep";

  const packages = await db
    .select()
    .from(residentialPackage)
    .where(
      and(
        eq(residentialPackage.company_id, co?.id ?? "00000000-0000-0000-0000-000000000000"),
        inArray(residentialPackage.status, ["published", "sold_out"])
      )
    )
    .orderBy(desc(residentialPackage.created_at));

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Logo name={brand} />
            <span className="text-gray-300">/</span>
            <span className="text-sm font-medium text-gray-600">Residential Leads</span>
          </div>
          <Link href="/buyers" className="text-sm text-gray-500 hover:text-gray-800">
            Back to dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Residential Opportunity Reports</h1>
          <p className="mt-2 text-lg text-gray-600">
            New homeowner and new construction signals for local landscapers and outdoor service providers.
          </p>
        </div>

        {packages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
            <h3 className="text-lg font-medium text-gray-900">No residential packages available yet</h3>
            <p className="mt-2 text-gray-500">
              We&apos;re currently sourcing new residential opportunities in your area. Check back soon!
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {packages.map((pkg) => {
              const teaser = pkg.signal_summary as PackageTeaser | null;
              return (
                <div key={pkg.id} className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:shadow-md">
                  <div className="p-6">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">{pkg.name}</h3>
                        <p className="text-sm font-medium text-brand">{pkg.geography_label}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        pkg.status === "sold_out" ? "bg-gray-100 text-gray-600" : "bg-brand/10 text-brand"
                      }`}>
                        {pkg.status === "sold_out" ? "SOLD OUT" : "AVAILABLE"}
                      </span>
                    </div>

                    <div className="mt-6 grid grid-cols-2 gap-4">
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Leads</div>
                        <div className="mt-1 text-xl font-extrabold">{pkg.lead_count}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Expected new-contract value</div>
                        <div className="mt-1 text-sm font-bold text-gray-900">
                          {teaser ? `$${teaser.ltvRange.low.toLocaleString()}–$${teaser.ltvRange.high.toLocaleString()}` : "—"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-6">
                      <div className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Primary Signals</div>
                      <div className="flex flex-wrap gap-2">
                        {teaser && Object.entries(teaser.signalCounts).slice(0, 3).map(([type, count]) => (
                          <span key={type} className="rounded-md bg-gray-100 px-2 py-1 text-[10px] font-medium text-gray-600">
                            {type.replace(/_/g, " ")} ({count})
                          </span>
                        ))}
                      </div>
                    </div>

                    <p className="mt-6 text-xs text-gray-500 leading-relaxed">
                      Includes property addresses, signal dates, and estimated home values.
                      Verified high-intent movers only.
                    </p>
                  </div>
                  <div className="mt-auto border-t border-gray-100 bg-gray-50 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-bold text-gray-900">{usd(pkg.price_cents / 100, { cents: false })}</span>
                      {pkg.status === "published" ? (
                        // Purchases aren't wired yet (residential is pre-launch)
                        // — a dead-looking live button erodes trust.
                        <button disabled title="Residential reports go on sale soon" className="rounded-lg bg-gray-300 px-4 py-2 text-sm font-semibold text-white shadow-sm cursor-not-allowed">
                          On sale soon
                        </button>
                      ) : (
                        <button disabled className="rounded-lg bg-gray-300 px-4 py-2 text-sm font-semibold text-white shadow-sm cursor-not-allowed">
                          Sold Out
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-12 rounded-2xl bg-brand/5 p-8 border border-brand/10">
          <h2 className="text-xl font-bold text-gray-900">Why Residential Lead Reports?</h2>
          <p className="mt-2 text-gray-600 leading-relaxed">
            Unlike commercial contracts, residential landscaping is driven by property events.
            A new home sale or a pool permit is the highest-intent signal for a new outdoor service contract.
            We bypass unreliable turf measurement and focus on <strong>who is ready to buy.</strong>
          </p>
        </div>
      </main>
    </div>
  );
}
