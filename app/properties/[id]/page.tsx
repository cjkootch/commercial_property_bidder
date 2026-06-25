import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveConfig, getPropertyDetail, toEngineConfig } from "@/lib/db/queries";
import { saveMeasurement, ensurePropertyGeocoded, ensurePropertyParcel } from "../actions";
import { AckReviewToggle } from "@/components/AckReviewToggle";
import { MeasureMapLoader } from "@/components/MeasureMapLoader";
import { CalcBreakdown } from "@/components/CalcBreakdown";
import { computePricing } from "@/lib/pricing/engine";
import { getMapboxToken, DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/integrations/geocoding";
import { usd, pct, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PropertyWorkspace({
  params,
}: {
  params: { id: string };
}) {
  const detail = await getPropertyDetail(params.id);
  if (!detail) notFound();

  const { property: prop, measurement: meas, pricing, flags, serviceAreas, mapView } = detail;
  const save = saveMeasurement.bind(null, prop.id);

  // Lazily geocode the address so the map can center on the property.
  const coords = await ensurePropertyGeocoded(prop.id);
  const geocoded = coords != null;
  const center: [number, number] = mapView?.center ?? coords ?? DEFAULT_CENTER;
  const zoom = mapView?.zoom ?? DEFAULT_ZOOM;
  const mapToken = getMapboxToken();

  // Resolve the county parcel boundary (cached after first fetch) for the
  // reference overlay.
  const parcel = await ensurePropertyParcel(prop.id);

  // Recompute a breakdown for the calc-audit panel (cheap, pure; nothing stored).
  const cfgRow = await getActiveConfig(prop.company_id);
  const breakdownResult =
    meas && cfgRow
      ? computePricing(
          {
            turf_sqft: meas.turf_sqft,
            bed_sqft: meas.bed_sqft,
            complexity: Number(meas.complexity),
            confidence: meas.confidence,
          },
          toEngineConfig(cfgRow),
          { breakdown: true }
        )
      : null;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand">
          ← Dashboard
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{prop.name}</h1>
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
            {titleCase(prop.status)}
          </span>
          {pricing?.needs_review ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
              Needs review
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {[prop.address, prop.city, prop.zip].filter(Boolean).join(", ") || "No address"} ·{" "}
          {titleCase(prop.icp_type)}
          {prop.owner_org ? ` · ${prop.owner_org}` : ""}
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Measurements */}
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-medium">Measurements</h2>
          <p className="mt-1 text-sm text-gray-500">
            Saving recomputes the price instantly.
          </p>
          <form action={save} className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <NumField name="turf_sqft" label="Turf (sqft)" defaultValue={meas?.turf_sqft} />
              <NumField name="bed_sqft" label="Bed (sqft)" defaultValue={meas?.bed_sqft} />
              <NumField name="shrub_count" label="Shrubs" defaultValue={meas?.shrub_count ?? undefined} />
              <NumField name="tree_count" label="Trees" defaultValue={meas?.tree_count ?? undefined} />
              <NumField name="edging_lf" label="Edging (lin ft)" defaultValue={meas?.edging_lf ?? undefined} />
              <NumField
                name="complexity"
                label="Complexity (×)"
                step="0.1"
                defaultValue={meas ? Number(meas.complexity) : 1.0}
              />
            </div>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Measurement confidence</span>
              <select
                name="confidence"
                defaultValue={meas?.confidence ?? "Med"}
                className="input mt-1"
              >
                <option value="High">High</option>
                <option value="Med">Med</option>
                <option value="Low">Low (triggers review)</option>
              </select>
            </label>
            <button
              type="submit"
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
            >
              Save &amp; recompute
            </button>
          </form>
        </section>

        {/* Pricing result */}
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-medium">Pricing</h2>
          {pricing ? (
            <>
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <Stat label="Price / visit" value={usd(pricing.price_per_visit)} big />
                <Stat label="Monthly" value={usd(pricing.monthly_price)} big />
                <Stat label="Annual" value={usd(pricing.annual_price)} />
                <Stat label="Gross margin" value={pct(pricing.gross_margin_pct)} />
                <Stat label="Cost / visit" value={usd(pricing.cost_per_visit)} />
                <Stat label="Min acceptable" value={usd(pricing.min_acceptable_price)} />
                <Stat label="Cole annual cut" value={usd(pricing.cole_annual_cut)} />
                <Stat
                  label="$ / acre / visit"
                  value={pricing.implied_per_acre_visit ? usd(pricing.implied_per_acre_visit) : "n/a"}
                />
              </dl>

              {flags && flags.reasons.length > 0 ? (
                <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm font-medium text-amber-900">Review flags</p>
                  <ul className="mt-1 list-inside list-disc text-sm text-amber-800">
                    {flags.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-5 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                  No review flags — clear to proceed.
                </p>
              )}

              {pricing.needs_review ? (
                <div className="mt-4">
                  <AckReviewToggle propertyId={prop.id} initial={prop.acknowledged_review} />
                </div>
              ) : null}
            </>
          ) : (
            <p className="mt-4 text-sm text-gray-500">
              No pricing yet. Enter measurements and save to generate a quote.
            </p>
          )}
        </section>
      </div>

      {/* Aerial measure & audit */}
      <MeasureMapLoader
        token={mapToken}
        propertyId={prop.id}
        center={center}
        zoom={zoom}
        geocoded={geocoded}
        initialAreas={serviceAreas}
        parcel={parcel}
        initial={{
          turf_sqft: meas?.turf_sqft ?? 0,
          bed_sqft: meas?.bed_sqft ?? 0,
          complexity: meas ? Number(meas.complexity) : 1.0,
          confidence: meas?.confidence ?? "Med",
        }}
      />

      {/* Pricing calculation audit */}
      {breakdownResult?.breakdown ? (
        <CalcBreakdown result={breakdownResult} breakdown={breakdownResult.breakdown} />
      ) : null}

      {/* Downstream phases — present as seams, built in later phases. */}
      <section className="rounded-lg border border-dashed border-gray-300 bg-white/50 p-5 text-sm text-gray-500">
        <h2 className="text-base font-medium text-gray-700">Next steps</h2>
        <p className="mt-1">
          Contacts (Apollo enrichment), proposal page, and outreach drafting attach here in the
          following build phases.
        </p>
      </section>
    </div>
  );
}

function NumField({
  name,
  label,
  defaultValue,
  step,
}: {
  name: string;
  label: string;
  defaultValue?: number;
  step?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <input
        type="number"
        name={name}
        step={step ?? "1"}
        min="0"
        defaultValue={defaultValue ?? ""}
        className="input mt-1"
      />
    </label>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className={big ? "text-lg font-semibold text-gray-900" : "text-gray-900"}>{value}</dd>
    </div>
  );
}
