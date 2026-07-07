import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, prospect } from "@/lib/db/schema";
import { getDefaultCompany } from "@/lib/db/queries";
import { getMapboxToken, DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/integrations/geocoding";
import { Logo } from "@/components/Logo";
import { MeasureMapLoader } from "@/components/MeasureMapLoader";
import type { MapView, ParcelResult, ServiceAreaCollection } from "@/lib/geo/types";
import type { Confidence } from "@/lib/pricing/types";
import { currentBuyerId } from "../../actions";
import {
  deleteProspect,
  ensureProspectScanned,
  estimateProspectVeg,
  saveProspectGeometry,
  setProspectPrice,
  startProspectPostcardCheckout,
} from "../actions";
import { postcardPriceCents } from "@/lib/integrations/stripe";

export const dynamic = "force-dynamic";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default async function ProspectWorkspace({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { mailed?: string; canceled?: string; perr?: string };
}) {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");

  // Lazy scan on first open (no-op once scanned), then read the fresh row.
  await ensureProspectScanned(params.id).catch(() => null);

  const [p] = await db
    .select()
    .from(prospect)
    .where(and(eq(prospect.id, params.id), eq(prospect.buyer_id, buyerId!)))
    .limit(1);
  if (!p) notFound();
  const [me] = await db.select().from(buyer).where(eq(buyer.id, buyerId!)).limit(1);
  if (!me) redirect("/buyers/login");
  const co = await getDefaultCompany();
  const brand = co?.name ?? "Greenkeep";

  const token = getMapboxToken();
  const mapView = p.map_view as MapView | null;
  const center: [number, number] =
    mapView?.center ?? (p.lng != null && p.lat != null ? [p.lng, p.lat] : DEFAULT_CENTER);
  const zoom = mapView?.zoom ?? DEFAULT_ZOOM;

  const monthly =
    p.price_override_cents != null ? p.price_override_cents / 100 : p.monthly_price ?? null;
  const overridden = p.price_override_cents != null;
  const needsOffice = !me.address || !me.city || !me.zip;
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "") || "";
  const quoteUrl = `${base || ""}/quote/${p.proposal_slug}`;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3.5">
          <Logo name={brand} />
          <Link href="/buyers/prospects" className="text-sm text-gray-500 hover:text-gray-800">
            ← All prospects
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{p.name || p.address}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {p.address}
              {p.city ? `, ${p.city}` : ""}
              {p.zip ? ` ${p.zip}` : ""}
            </p>
          </div>
          <form action={deleteProspect.bind(null, p.id)}>
            <button className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
              {p.status === "mailed" || p.status === "viewed" ? "Archive" : "Delete"}
            </button>
          </form>
        </div>

        {searchParams.mailed ? (
          <p className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            Postcard sent to print — it&apos;s on its way to the property.
          </p>
        ) : searchParams.canceled ? (
          <p className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
            Checkout canceled — no charge.
          </p>
        ) : searchParams.perr ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {searchParams.perr}
          </p>
        ) : null}

        {/* Estimate + price override */}
        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Estimate</h2>
            <div className="mt-2 text-3xl font-bold text-gray-900">
              {monthly != null ? `${usd(monthly)}/mo` : "Pending"}
            </div>
            {p.annual_price != null ? (
              <div className="mt-1 text-sm text-gray-500">
                {overridden ? (
                  <>Your price · {usd(monthly! * 12)}/yr</>
                ) : (
                  <>
                    {usd(p.estimate_lo ?? p.annual_price * 0.9)}–
                    {usd(p.estimate_hi ?? p.annual_price * 1.15)}/yr estimated
                  </>
                )}
              </div>
            ) : (
              <div className="mt-1 text-sm text-gray-500">
                Draw the service area below to generate an estimate.
              </div>
            )}
            <p className="mt-3 text-xs text-gray-400">
              {p.turf_sqft ? `${Math.round(p.turf_sqft).toLocaleString()} sq ft turf measured. ` : ""}
              Estimate from aerial measurement — confirm on a walkthrough.
            </p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Your price
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Override the estimate with what you&apos;d actually charge — this shows on the quote page
              and postcard.
            </p>
            <form
              action={async (fd: FormData) => {
                "use server";
                const v = Number(fd.get("monthly"));
                await setProspectPrice(p.id, Number.isFinite(v) && v > 0 ? v : null);
              }}
              className="mt-3 flex items-center gap-2"
            >
              <span className="text-sm text-gray-500">$</span>
              <input
                name="monthly"
                type="number"
                min="0"
                step="1"
                defaultValue={p.price_override_cents != null ? Math.round(p.price_override_cents / 100) : ""}
                placeholder={p.monthly_price != null ? String(Math.round(p.monthly_price)) : "0"}
                className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
              <span className="text-sm text-gray-500">/mo</span>
              <button className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                Save
              </button>
            </form>
          </div>
        </section>

        {/* Measure & adjust the service area */}
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Service area
          </h2>
          <p className="mt-1 mb-3 text-xs text-gray-500">
            Trace the turf and beds you&apos;d maintain. Saving re-prices the estimate. These edits
            stay private to you.
          </p>
          <MeasureMapLoader
            token={token}
            center={center}
            zoom={zoom}
            geocoded={p.lat != null && p.lng != null}
            initialAreas={(p.service_areas as ServiceAreaCollection | null) ?? null}
            parcel={(p.parcel_geojson as ParcelResult | null) ?? null}
            initialCountTreeGrass={mapView?.count_tree_grass ?? false}
            initial={{
              turf_sqft: p.turf_sqft ?? 0,
              bed_sqft: p.bed_sqft ?? 0,
              complexity: p.complexity ? Number(p.complexity) : 1.0,
              confidence: (p.confidence as Confidence) ?? "Med",
            }}
            onSave={saveProspectGeometry.bind(null, p.id)}
            onEstimateVeg={estimateProspectVeg.bind(null, p.id)}
          />
        </section>

        {/* Quote page + mail */}
        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Your quote page
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              A branded page with the aerial, measurement, and estimate — the postcard&apos;s QR points
              here.
            </p>
            <a
              href={`/quote/${p.proposal_slug}`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block break-all text-sm font-medium text-brand hover:underline"
            >
              {quoteUrl || `/quote/${p.proposal_slug}`}
            </a>
            <p className="mt-2 text-xs text-gray-400">Opened {p.view_count}×</p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Mail a postcard
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              We print &amp; mail a branded card to this property with a QR to your quote page.
            </p>
            <a
              href={`/buyers/prospects/${p.id}/postcard-preview`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-sm font-semibold text-brand hover:underline"
            >
              Preview the postcard →
            </a>
            {needsOffice ? (
              <p className="mt-3 text-xs text-amber-700">
                Add your office address in{" "}
                <Link href="/buyers/profile" className="font-semibold underline">
                  your profile
                </Link>{" "}
                first (return address).
              </p>
            ) : (
              <form action={startProspectPostcardCheckout.bind(null, p.id)} className="mt-3">
                <button className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">
                  Mail this owner — {usd(postcardPriceCents() / 100)}
                </button>
              </form>
            )}
            {p.status === "mailed" || p.status === "viewed" ? (
              <p className="mt-2 text-xs text-green-700">A postcard has been mailed for this property.</p>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
