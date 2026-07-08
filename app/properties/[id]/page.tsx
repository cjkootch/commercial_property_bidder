import Link from "next/link";
import { notFound } from "next/navigation";
import {
  countNearbyProperties,
  getActiveConfig,
  getPropertyDetail,
  getPropertyProposal,
  getPropertyOutreach,
  toEngineConfig,
} from "@/lib/db/queries";
import {
  saveMeasurement,
  saveMeasurementWithGeometry,
  estimateServiceableArea,
  ensurePropertyGeocoded,
  ensurePropertyParcel,
  ensurePropertyPrediction,
  ensurePropertyOwnerSuggestion,
  archiveProperty,
  unarchiveProperty,
  offerLeadToBuyers,
} from "../actions";
import { AckReviewToggle } from "@/components/AckReviewToggle";
import { GrassScreen } from "@/components/GrassScreen";
import { OwnerSuggestion } from "@/components/OwnerSuggestion";
import { ContactFinder } from "@/components/ContactFinder";
import { ProposalCard } from "@/components/ProposalCard";
import type { ContactSuggestion } from "@/lib/integrations/contact";
import { MeasureMapLoader } from "@/components/MeasureMapLoader";
import { CalcBreakdown } from "@/components/CalcBreakdown";
import {
  computeLeadScore,
  estimateCompletionFromNotes,
  isRecentOwnerChange,
  monthsUntil,
  MIN_GRASS_FRACTION,
} from "@/lib/sourcing/criteria";
import { computePricing } from "@/lib/pricing/engine";
import { getMapboxToken, DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/integrations/geocoding";
import { usd, pct, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";
// First open of an unmeasured property may run geocode + county parcel + the
// hosted turf model (auto-draft) — don't die at the platform default.
export const maxDuration = 60;

export default async function PropertyWorkspace({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { offered?: string; offer_err?: string };
}) {
  // Lazy prep BEFORE the detail read (each is cached/no-op after first open):
  // geocode -> parcel -> model auto-draft, so a brand-new property opens with
  // the model's polygons already on the map, ready to correct.
  const coords = await ensurePropertyGeocoded(params.id);
  const parcel = await ensurePropertyParcel(params.id);
  await ensurePropertyPrediction(params.id).catch(() => null);

  const detail = await getPropertyDetail(params.id);
  if (!detail) notFound();

  const { property: prop, measurement: meas, pricing, flags, serviceAreas, mapView } = detail;
  const save = saveMeasurement.bind(null, prop.id);

  const geocoded = coords != null;
  const center: [number, number] = mapView?.center ?? coords ?? DEFAULT_CENTER;
  const zoom = mapView?.zoom ?? DEFAULT_ZOOM;
  const mapToken = getMapboxToken();

  // Suggest an ownership company from the parcel owner-of-record + Apollo
  // (cached; a suggestion the operator confirms, never auto-applied).
  const ownerSuggestion = await ensurePropertyOwnerSuggestion(prop.id);

  // Current hosted proposal (if any), for the shareable-link card.
  const proposalRow = await getPropertyProposal(prop.id);
  const proposalInfo = proposalRow
    ? {
        slug: proposalRow.slug,
        status: proposalRow.status,
        view_count: proposalRow.view_count,
        last_viewed_at: proposalRow.last_viewed_at?.toISOString() ?? null,
      }
    : null;

  // Buyer prospecting state for this lead (automated cold outreach to outside
  // landscaping companies — see lib/pipeline/buyer-prospecting).
  const { buyerOutreach } = await import("@/lib/db/schema");
  const { eq: eqOp } = await import("drizzle-orm");
  const { db: dbo } = await import("@/lib/db");
  const prospected = await dbo
    .select({ status: buyerOutreach.status })
    .from(buyerOutreach)
    .where(eqOp(buyerOutreach.property_id, prop.id));
  const prospectedSent = prospected.filter((r) => r.status === "sent").length;
  const prospectedQueued = prospected.filter((r) => r.status === "queued").length;

  const outreachRow = await getPropertyOutreach(prop.id);
  const outreachInfo = outreachRow
    ? {
        status: outreachRow.status,
        sent_at: outreachRow.sent_at?.toISOString() ?? null,
        delivered_at: outreachRow.delivered_at?.toISOString() ?? null,
        opened_at: outreachRow.opened_at?.toISOString() ?? null,
        open_count: outreachRow.open_count,
        click_count: outreachRow.click_count,
      }
    : null;

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

  // "Why this property": how it entered the funnel + the scored signals.
  const neighborsNearby = await countNearbyProperties(prop.id);
  const completion = estimateCompletionFromNotes(prop.notes);
  const leadScore = computeLeadScore({
    grassFraction: prop.grass_fraction,
    recentOwnerChange: isRecentOwnerChange(parcel?.last_sale_date ?? null),
    activelyLeasing: prop.actively_leasing,
    grossMarginPct: pricing?.gross_margin_pct ?? null,
    neighborsNearby,
    monthsToCompletion: monthsUntil(completion?.iso ?? null),
  });
  const isTabsLead = /\(TABS /.test(prop.name);
  const isTransferLead = /\(HCAD /.test(prop.name);
  const isOpeningLead = /\(STP /.test(prop.name);
  const isViolationLead = /\(H311 /.test(prop.name);
  const isTabcLead = /\(TABC /.test(prop.name);
  const isTaxSaleLead = /\(TAX /.test(prop.name);
  const isRfpLead = /\(RFP /.test(prop.name);
  const projectCost = prop.notes?.match(/est\. cost (\$[\d,]+)/)?.[1] ?? null;
  const saleDate = prop.notes?.match(/HCAD transfer (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  const opensDate = prop.notes?.match(/Opens (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  const auctionDate = prop.notes?.match(/Tax sale scheduled (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  const bidsClose = prop.notes?.match(/Bids close (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  const origin = isTabcLead
    ? `Found by the TABC pipeline: a pending alcohol-license application puts a bar/restaurant opening at this address — licensing runs 30-90 days ahead of opening day, so this is the earliest opening signal we have. The parcel is commercial and passed the vegetation pre-screen.`
    : isTaxSaleLead
    ? `Found by the tax-sale pipeline: this parcel is in the county's delinquent-tax process${auctionDate ? ` with an auction scheduled ${auctionDate}` : ""}. Forced action on both sides of the sale: the current owner needs the property presentable, and a post-auction buyer re-bids every vendor.`
    : isRfpLead
    ? `Found by the public-bid pipeline: a government agency is taking bids on this grounds/landscaping contract${bidsClose ? ` (bids close ${bidsClose})` : ""}. No parcel or measurement — the solicitation documents carry the site list and pricing forms. The lead auto-archives when the deadline passes.`
    : isTabsLead
    ? `Found by the permit pipeline: a state construction filing (TABS)${projectCost ? ` for a ${projectCost} project` : ""}. New construction means the first grounds contract hasn't been won yet — someone gets this property's maintenance when it opens, and the sheet sells that head start.`
    : isTransferLead
    ? `Found by the ownership-transfer pipeline: county deed records show this property sold${saleDate ? ` on ${saleDate}` : " recently"}, and its parcel passed the ≥${Math.round(MIN_GRASS_FRACTION * 100)}% vegetation pre-screen. New owners re-bid their vendors in the first year — the grounds contract is in play right now.`
    : isOpeningLead
    ? `Found by the business-opening pipeline: a new state sales-tax registration puts a business${opensDate ? ` opening ${opensDate}` : " opening soon"} at this address, on a commercial parcel that passed the ≥${Math.round(MIN_GRASS_FRACTION * 100)}% vegetation pre-screen. Openings are when a property's vendor decisions get made.`
    : isViolationLead
    ? "Found by the code-violation pipeline: Houston 311 records a grounds/cleanup citation (weeds, dumping, or heavy trash) on this commercial parcel. The owner is required to arrange service now — the most urgent signal any feed produces."
    : prop.source === "places"
      ? `Discovered by the sourcing pipeline: a commercial property in the NW-Houston corridor whose parcel passed the ≥${Math.round(MIN_GRASS_FRACTION * 100)}% vegetation pre-screen — enough grass to be worth measuring and quoting.`
      : prop.source === "inbound"
        ? "Came in through the public instant-quote funnel — the owner or manager asked for a price themselves."
        : "Added manually by the operator.";

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
          {prop.archived_at ? (
            <>
              <span className="rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-500">
                Archived
              </span>
              <form action={unarchiveProperty.bind(null, prop.id)}>
                <button className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50">
                  Restore
                </button>
              </form>
            </>
          ) : (
            <form action={archiveProperty.bind(null, prop.id)}>
              <button
                title="Hide from the dashboard and marketplace (training data is kept; reversible)"
                className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
              >
                Archive
              </button>
            </form>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {[prop.address, prop.city, prop.zip].filter(Boolean).join(", ") || "No address"} ·{" "}
          {titleCase(prop.icp_type)}
          {prop.owner_org ? ` · ${prop.owner_org}` : ""}
        </p>
        {searchParams.offered ? (
          <p className="mt-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            Offer sent to {searchParams.offered} nearby buyer{searchParams.offered === "1" ? "" : "s"} — the
            3-spot cap locks it as they claim; latecomers get routed to the next best open job.
          </p>
        ) : null}
        {searchParams.offer_err ? (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {searchParams.offer_err}
          </p>
        ) : null}
        {!prop.archived_at && !prop.lead_exported_at && prop.parcel_geojson ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <form action={offerLeadToBuyers.bind(null, prop.id)}>
              <button
                title="Email this lead to the nearest opted-in buyers (nearest-first, max 30). First come, first served against the 3-spot cap."
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark"
              >
                📣 Offer to nearby buyers
              </button>
            </form>
            {prop.offer_sent_at ? (
              <span className="text-xs text-gray-400">
                Last offered to {prop.offer_sent_count ?? 0} buyer{(prop.offer_sent_count ?? 0) === 1 ? "" : "s"} on{" "}
                {prop.offer_sent_at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            ) : null}
            {prospected.length > 0 ? (
              <span className="text-xs text-gray-400">
                Prospecting: {prospectedSent} sent · {prospectedQueued} queued of {prospected.length} outside companies
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Why this property: origin + the scored signals behind the lead number */}
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Why this property</h2>
          <span
            className={
              "rounded-full px-3 py-1 text-sm font-bold tabular-nums " +
              (leadScore.score >= 60
                ? "bg-green-100 text-green-800"
                : leadScore.score >= 40
                  ? "bg-amber-100 text-amber-800"
                  : "bg-gray-200 text-gray-600")
            }
          >
            Lead score {leadScore.score} / 100
          </span>
        </div>
        <p className="mt-2 text-sm text-gray-600">{origin}</p>
        <ul className="mt-4 space-y-2.5">
          {leadScore.parts.map((part) => (
            <li key={part.label} className="flex items-start gap-3">
              <div className="mt-0.5 w-24 shrink-0">
                <div className="text-right text-sm font-semibold tabular-nums text-gray-700">
                  {part.max > 0 ? `${part.points} / ${part.max}` : "n/a"}
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full ${part.points > 0 ? "bg-brand" : "bg-gray-200"}`}
                    style={{ width: `${part.max > 0 ? Math.round((part.points / part.max) * 100) : 0}%` }}
                  />
                </div>
              </div>
              <div className="min-w-0">
                <span className="text-sm font-medium text-gray-800">{part.label}</span>
                <span className="text-sm text-gray-500"> — {part.note}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

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

      {/* Ownership + free contact lookup */}
      <div className="grid gap-8 lg:grid-cols-2">
        <OwnerSuggestion
          propertyId={prop.id}
          ownerOrg={prop.owner_org}
          suggestion={ownerSuggestion}
          lastSaleDate={parcel?.last_sale_date ?? null}
          activelyLeasing={prop.actively_leasing}
        />
        <ContactFinder
          propertyId={prop.id}
          suggestion={(prop.contact_suggestion as ContactSuggestion | null) ?? null}
        />
      </div>

      {/* Hosted proposal link + open tracking */}
      <ProposalCard
        propertyId={prop.id}
        initial={proposalInfo}
        hasPricing={!!pricing}
        outreach={outreachInfo}
      />

      {/* Sourcing grass pre-screen */}
      <GrassScreen
        propertyId={prop.id}
        initialFraction={prop.grass_fraction ?? null}
        threshold={MIN_GRASS_FRACTION}
      />

      {/* Aerial measure & audit */}
      <MeasureMapLoader
        token={mapToken}
        center={center}
        zoom={zoom}
        geocoded={geocoded}
        initialAreas={serviceAreas}
        parcel={parcel}
        initialCountTreeGrass={mapView?.count_tree_grass ?? false}
        initial={{
          turf_sqft: meas?.turf_sqft ?? 0,
          bed_sqft: meas?.bed_sqft ?? 0,
          complexity: meas ? Number(meas.complexity) : 1.0,
          confidence: meas?.confidence ?? "Med",
        }}
        onSave={saveMeasurementWithGeometry.bind(null, prop.id)}
        onEstimateVeg={estimateServiceableArea.bind(null, prop.id)}
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
