import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, inArray, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { residentialPackage } from "@/lib/db/schema";
import { packageSampleLeads, fmtSaleDate } from "@/lib/residential/samples";
import { packageSpotsLeft, resiMaxBuyers } from "@/lib/residential/availability";
import { startGuestPackageCheckout } from "./actions";
import type { PackageTeaser } from "@/lib/residential/teaser";
import { usd } from "@/lib/format";

// PUBLIC package preview (2026-07-22 "we're asking too much" funnel fix):
// the pitch CTA lands here — no login wall, real sample addresses, one
// buy button straight into guest Stripe checkout. /residential is a public
// prefix in middleware, so this route needs no auth changes.
export const dynamic = "force-dynamic";

export default async function PublicPackagePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { purchased?: string; canceled?: string; err?: string; trade?: string };
}) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const [pkg] = await db
    .select()
    .from(residentialPackage)
    .where(
      and(
        eq(residentialPackage.id, params.id),
        inArray(residentialPackage.status, ["published", "sold_out"])
      )
    )
    .limit(1);
  if (!pkg) notFound();

  const [samples, lawnSpots, pestSpots] = await Promise.all([
    packageSampleLeads(pkg.id, 3),
    packageSpotsLeft(pkg.id, "landscaping"),
    packageSpotsLeft(pkg.id, "pest"),
  ]);
  const cap = resiMaxBuyers();
  const teaser = pkg.signal_summary as PackageTeaser | null;
  const defaultTrade = searchParams?.trade === "pest" ? "pest" : "landscaping";
  const buyable = pkg.status === "published" && (lawnSpots > 0 || pestSpots > 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-2xl px-6 py-12">
        <p className="text-sm font-semibold text-brand">Greenkeep · new-homeowner address list</p>
        <h1 className="mt-1 text-3xl font-bold text-gray-900">{pkg.name}</h1>
        <p className="mt-2 text-gray-600">
          {pkg.lead_count} families just bought homes in {pkg.geography_label ?? pkg.zip ?? "this area"} —
          pulled straight from county deed records, every sale date shown. New owners pick their
          lawn and pest providers in the first weeks.
        </p>

        {searchParams?.purchased ? (
          <div className="mt-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            Payment received — check your email for your report link (it signs you in
            automatically). It usually arrives within a minute.
          </div>
        ) : null}
        {searchParams?.canceled ? (
          <div className="mt-6 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
            Checkout canceled — the list is still here whenever you&apos;re ready.
          </div>
        ) : null}
        {searchParams?.err ? (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {searchParams.err}
          </div>
        ) : null}

        {samples.length > 0 ? (
          <div className="mt-8 rounded-2xl border border-brand/20 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400">
              {samples.length} of the {pkg.lead_count}, free — go look
            </h2>
            <ul className="mt-3 space-y-2">
              {samples.map((s) => (
                <li key={s.address} className="flex items-baseline justify-between gap-4">
                  <span className="font-medium text-gray-900">
                    {s.address}
                    {s.city ? `, ${s.city}` : ""}
                  </span>
                  <span className="shrink-0 text-sm text-gray-500">
                    {fmtSaleDate(s.saleDate) ? `closed ${fmtSaleDate(s.saleDate)}` : "recent sale"}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-gray-500">
              Real addresses from the list. Drive past them today — then decide.
            </p>
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-white border border-gray-200 p-3 text-center">
            <div className="text-xl font-extrabold text-gray-900">{pkg.lead_count}</div>
            <div className="text-[11px] uppercase tracking-wider text-gray-400">addresses</div>
          </div>
          <div className="rounded-lg bg-white border border-gray-200 p-3 text-center">
            <div className="text-xl font-extrabold text-gray-900">
              {teaser ? `$${Math.round((teaser.ltvRange.low + teaser.ltvRange.high) / 2).toLocaleString()}` : "—"}
            </div>
            <div className="text-[11px] uppercase tracking-wider text-gray-400">est. contract value</div>
          </div>
          <div className="rounded-lg bg-white border border-gray-200 p-3 text-center">
            <div className="text-xl font-extrabold text-gray-900">{cap}</div>
            <div className="text-[11px] uppercase tracking-wider text-gray-400">max buyers / trade</div>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold text-gray-900">{usd(pkg.price_cents / 100, { cents: false })}</span>
            <span className="text-sm text-gray-500">one-time · CSV included · owner names on every address</span>
          </div>
          {buyable ? (
            <form action={startGuestPackageCheckout.bind(null, pkg.id)} className="mt-4">
              <fieldset className="flex gap-4 text-sm text-gray-700">
                <label className="flex items-center gap-2">
                  <input type="radio" name="trade" value="landscaping" defaultChecked={defaultTrade === "landscaping"} disabled={lawnSpots <= 0} />
                  Landscaping / lawn {lawnSpots <= 0 ? "(sold out)" : `(${lawnSpots} of ${cap} spots left)`}
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="trade" value="pest" defaultChecked={defaultTrade === "pest"} disabled={pestSpots <= 0} />
                  Pest control {pestSpots <= 0 ? "(sold out)" : `(${pestSpots} of ${cap} spots left)`}
                </label>
              </fieldset>
              <button className="mt-4 w-full rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand/90">
                Get the full list — {usd(pkg.price_cents / 100, { cents: false })}
              </button>
              <p className="mt-2 text-center text-xs text-gray-400">
                No account needed — pay with card, the report arrives by email.
              </p>
            </form>
          ) : (
            <div className="mt-4 rounded-lg bg-gray-100 px-4 py-3 text-center text-sm font-semibold text-gray-500">
              Sold out — every spot on this list is taken.
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Already have a Greenkeep account? <Link href="/buyers/login" className="underline">Sign in</Link> ·
          More lists at <Link href="/buyers/residential" className="underline">the marketplace</Link>
        </p>
      </main>
    </div>
  );
}
