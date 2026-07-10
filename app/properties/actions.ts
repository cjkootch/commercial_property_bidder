"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  company,
  contact,
  measurement,
  outreach,
  pricingResult,
  property,
  proposal,
  proposalView,
  suppression,
} from "@/lib/db/schema";
import { sendEmail, getResendKey } from "@/lib/integrations/resend";
import {
  DEFAULT_SCOPE_ITEMS,
  frequencyOptionsFromPricing,
  makeProposalSlug,
} from "@/lib/proposals";
import { getActiveConfig, getDefaultCompany, toEngineConfig } from "@/lib/db/queries";
import { computePricing } from "@/lib/pricing/engine";
import type { Confidence } from "@/lib/pricing/types";
import type {
  MapView,
  ParcelResult,
  ServiceAreaCollection,
  ServiceAreaFeature,
} from "@/lib/geo/types";
import { geocodeAddress, getMapboxToken } from "@/lib/integrations/geocoding";
import { fetchParcelAtPoint } from "@/lib/integrations/parcel";
import { fetchOsmFeaturesInParcel } from "@/lib/integrations/osm";
import {
  estimateServiceableArea as estimateServiceableAreaImpl,
  type ServiceableEstimate,
} from "@/lib/integrations/imagery";
import { isGrassQualified, MIN_GRASS_FRACTION } from "@/lib/sourcing/criteria";
import {
  enrichCompanyByName,
  parcelSuggestion,
  type OwnerSuggestion,
} from "@/lib/integrations/apollo";
import { findContact, type ContactSuggestion } from "@/lib/integrations/contact";

const ICP_VALUES = [
  "self_storage",
  "office_park",
  "medical",
  "church",
  "daycare",
  "retail_strip",
  "industrial",
  "other",
] as const;

function num(formData: FormData, key: string, fallback = 0): number {
  const raw = formData.get(key);
  const n = raw === null || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Create a property (build spec section 7: /properties/new). */
export async function createProperty(formData: FormData) {
  const co = await getDefaultCompany();
  if (!co) throw new Error("No company seeded. Run `npm run db:seed`.");

  const name = (formData.get("name") as string)?.trim();
  if (!name) throw new Error("Property name is required.");

  const icpRaw = (formData.get("icp_type") as string) ?? "other";
  const icp = (ICP_VALUES as readonly string[]).includes(icpRaw)
    ? (icpRaw as (typeof ICP_VALUES)[number])
    : "other";

  const [prop] = await db
    .insert(property)
    .values({
      company_id: co.id,
      name,
      address: ((formData.get("address") as string) || "").trim() || null,
      city: ((formData.get("city") as string) || "").trim() || null,
      zip: ((formData.get("zip") as string) || "").trim() || null,
      icp_type: icp,
      owner_org: ((formData.get("owner_org") as string) || "").trim() || null,
      source: "manual",
      status: "sourced",
    })
    .returning();

  redirect(`/properties/${prop.id}`);
}

/** Structured measurement input shared by the form and the map save paths. */
type MeasurementInput = {
  turf_sqft: number;
  bed_sqft: number;
  complexity: number;
  confidence: Confidence;
  shrub_count?: number | null;
  tree_count?: number | null;
  edging_lf?: number | null;
  source?: "manual" | "siterecon" | "map_draw";
  service_areas?: ServiceAreaCollection | null;
  map_view?: MapView | null;
};

/**
 * Core persistence: insert a measurement snapshot, run the pricing engine,
 * insert the pricing_result, advance the pipeline to `priced`, and revalidate.
 * Shared by saveMeasurement (form) and saveMeasurementWithGeometry (map).
 * Not exported, so it is a plain helper, not a server action.
 */
async function persistMeasurementAndPrice(propertyId: string, input: MeasurementInput) {
  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop) throw new Error("Property not found.");

  const cfgRow = await getActiveConfig(prop.company_id);
  if (!cfgRow) throw new Error("No active pricing config for this company.");

  const complexity = input.complexity || 1.0;

  const [meas] = await db
    .insert(measurement)
    .values({
      property_id: propertyId,
      turf_sqft: input.turf_sqft,
      bed_sqft: input.bed_sqft,
      shrub_count: input.shrub_count ?? null,
      tree_count: input.tree_count ?? null,
      edging_lf: input.edging_lf ?? null,
      complexity: complexity.toFixed(2),
      confidence: input.confidence,
      source: input.source ?? "manual",
      service_areas: input.service_areas ?? null,
      map_view: input.map_view ?? null,
    })
    .returning();

  const result = computePricing(
    { turf_sqft: input.turf_sqft, bed_sqft: input.bed_sqft, complexity, confidence: input.confidence },
    toEngineConfig(cfgRow)
  );

  await db.insert(pricingResult).values({
    property_id: propertyId,
    measurement_id: meas.id,
    config_id: cfgRow.id,
    cost_per_visit: result.cost_per_visit,
    price_per_visit: result.price_per_visit,
    gross_profit_per_visit: result.gross_profit_per_visit,
    gross_margin_pct: result.gross_margin_pct,
    min_acceptable_price: result.min_acceptable_price,
    monthly_price: result.monthly_price,
    annual_price: result.annual_price,
    annual_gross_profit: result.annual_gross_profit,
    cole_annual_cut: result.cole_annual_cut,
    implied_per_acre_visit: result.implied_per_acre_visit,
    crew_hours_per_visit: result.crew_hours_per_visit,
    flags: result.flags,
    needs_review: result.needs_review,
  });

  // Advance pipeline to "priced" only from the initial stage; never downgrade.
  if (prop.status === "sourced") {
    await db.update(property).set({ status: "priced", updated_at: new Date() }).where(eq(property.id, propertyId));
  }

  // Marketplace leads: an operator measurement refreshes the shelf teaser —
  // verified numbers with a tighter band (±10%) replace the automated
  // estimate, so the card, rank, tier, and outreach copy all upgrade the
  // moment the lead is hand-measured. (Sold sheets are unlock-time snapshots
  // and keep whatever the buyer bought.)
  if (/\((TABS|HCAD|STP|H311|TABC|TAX) [^)]+\)$/.test(prop.name)) {
    const { sizeLeadFromMeasurement } = await import("@/lib/leads/sizing");
    const { default: turfArea } = await import("@turf/area");
    const { M2_TO_SQFT } = await import("@/lib/geo/area");
    const parcelGeom = (prop.parcel_geojson as { geometry?: GeoJSON.Geometry } | null)?.geometry;
    const parcelSqft = parcelGeom ? turfArea(parcelGeom) * M2_TO_SQFT : 0;
    const sized = sizeLeadFromMeasurement(
      { turf_sqft: input.turf_sqft, bed_sqft: input.bed_sqft, complexity, confidence: input.confidence },
      parcelSqft,
      toEngineConfig(cfgRow)
    );
    await db
      .update(property)
      .set({
        lead_teaser: {
          annual_lo: sized.annual_lo,
          annual_hi: sized.annual_hi,
          turf_sqft: sized.turf_sqft,
          projected: false,
          verified: true,
          computed_at: new Date().toISOString().slice(0, 10),
        },
        updated_at: new Date(),
      })
      .where(eq(property.id, propertyId));
  }

  revalidatePath(`/properties/${propertyId}`);
  revalidatePath("/dashboard");
}

function toConfidence(raw: unknown): Confidence {
  return (["High", "Med", "Low"] as const).includes(raw as Confidence)
    ? (raw as Confidence)
    : "Med";
}

/**
 * Save measurements from the manual form and recompute pricing (build spec
 * section 7: "recompute pricing on save").
 */
export async function saveMeasurement(propertyId: string, formData: FormData) {
  await persistMeasurementAndPrice(propertyId, {
    turf_sqft: num(formData, "turf_sqft"),
    bed_sqft: num(formData, "bed_sqft"),
    complexity: num(formData, "complexity", 1.0) || 1.0,
    confidence: toConfidence(formData.get("confidence")),
    shrub_count: Math.trunc(num(formData, "shrub_count")) || null,
    tree_count: Math.trunc(num(formData, "tree_count")) || null,
    edging_lf: num(formData, "edging_lf") || null,
    source: "manual",
  });
}

/** Payload sent by the map workspace when saving drawn service areas. */
export type GeometrySavePayload = {
  turf_sqft: number;
  bed_sqft: number;
  complexity: number;
  confidence: Confidence;
  service_areas: ServiceAreaCollection;
  map_view: MapView;
  /** Map center the operator settled on, to back-fill property lat/lng. */
  lat?: number | null;
  lng?: number | null;
};

/**
 * Save measurements derived from drawn map polygons. Persists the geometry +
 * map view, back-fills property lat/lng if provided, and re-prices. The drawn
 * sqft totals are passed in but the operator may have overridden them in the
 * form fields before saving — the caller decides which values to send.
 */
export async function saveMeasurementWithGeometry(
  propertyId: string,
  payload: GeometrySavePayload
) {
  if (payload.lat != null && payload.lng != null) {
    await db
      .update(property)
      .set({ lat: payload.lat, lng: payload.lng, updated_at: new Date() })
      .where(eq(property.id, propertyId));
  }

  await persistMeasurementAndPrice(propertyId, {
    turf_sqft: payload.turf_sqft,
    bed_sqft: payload.bed_sqft,
    complexity: payload.complexity || 1.0,
    confidence: toConfidence(payload.confidence),
    source: "map_draw",
    service_areas: payload.service_areas,
    map_view: payload.map_view,
  });
}

/**
 * Soft-archive a reviewed/used-for-modelling property: hides it from the
 * dashboard pipeline and the buyer marketplace. Its measurements stay, so the
 * ML training export is unaffected. Reversible via unarchiveProperty.
 */
export async function archiveProperty(propertyId: string): Promise<void> {
  await db
    .update(property)
    .set({ archived_at: new Date(), updated_at: new Date() })
    .where(eq(property.id, propertyId));
  revalidatePath("/dashboard");
  revalidatePath(`/properties/${propertyId}`);
  redirect("/dashboard");
}

/** Restore an archived property to the working lists. */
export async function unarchiveProperty(propertyId: string): Promise<void> {
  await db
    .update(property)
    .set({ archived_at: null, updated_at: new Date() })
    .where(eq(property.id, propertyId));
  revalidatePath("/dashboard");
  revalidatePath(`/properties/${propertyId}`);
}

/**
 * Lazily geocode a property's address to lat/lng on first map open. No-op if
 * already geocoded or if geocoding fails (the map falls back to a draggable
 * pin). Returns the current [lng, lat] or null.
 */
export async function ensurePropertyGeocoded(
  propertyId: string
): Promise<[number, number] | null> {
  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop) return null;
  if (prop.lng != null && prop.lat != null) return [prop.lng, prop.lat];

  const addressParts = [prop.address, prop.city, prop.zip, "TX"].filter(Boolean).join(", ");
  const coords = await geocodeAddress(addressParts);
  if (!coords) return null;

  await db
    .update(property)
    .set({ lng: coords[0], lat: coords[1], updated_at: new Date() })
    .where(eq(property.id, propertyId));
  // No revalidatePath here: this runs during page render (the coords are used
  // immediately) and revalidatePath is not allowed during render.
  return coords;
}

/**
 * Lazily resolve & cache the county parcel boundary for a property. No-op if
 * already cached or if the property has no coordinates. Resilient: county GIS
 * failures return the existing (possibly null) value rather than throwing.
 * Safe to call during render (no revalidatePath).
 */
export async function ensurePropertyParcel(
  propertyId: string
): Promise<ParcelResult | null> {
  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop) return null;
  if (prop.parcel_geojson) return prop.parcel_geojson as ParcelResult;
  if (prop.lng == null || prop.lat == null) return null;

  const parcel = await fetchParcelAtPoint(prop.lng, prop.lat);
  if (!parcel) return null;

  await db
    .update(property)
    .set({ parcel_geojson: parcel, updated_at: new Date() })
    .where(eq(property.id, propertyId));
  return parcel;
}

/**
 * Auto-draft service areas from the hosted turf model on first open: if the
 * property has a parcel, NO measurement of any kind yet, and TURF_MODEL_URL is
 * configured, run inference and insert an editable 'ml_pred' draft (+ pricing),
 * exactly like scripts/seed-predictions.ts does in batch. The operator corrects
 * the draft and saves — a clean human label. Safe during render (no
 * revalidatePath); no-ops fast on every later open (a measurement exists).
 */
export async function ensurePropertyPrediction(propertyId: string): Promise<void> {
  const { getTurfModelUrl, predictServiceAreas } = await import("@/lib/integrations/turf-model");
  if (!getTurfModelUrl()) return;

  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop?.parcel_geojson) return;
  const [existing] = await db
    .select({ id: measurement.id })
    .from(measurement)
    .where(eq(measurement.property_id, propertyId))
    .limit(1);
  if (existing) return;

  const pred = await predictServiceAreas(prop.parcel_geojson as ParcelResult, getMapboxToken());
  if (!pred) return;
  // Sports turf must earn its label: plausible property context or an
  // OSM-mapped pitch, else it demotes to plain turf (same area, honest kind).
  const { screenSportsTurf } = await import("@/lib/integrations/turf-model");
  const parcelForScreen = prop.parcel_geojson as ParcelResult;
  const screened = await screenSportsTurf(
    pred.service_areas,
    `${prop.name} ${prop.owner_org ?? ""} ${parcelForScreen.owner ?? ""} ${prop.notes ?? ""}`,
    parcelForScreen
  );
  pred.service_areas = screened.service_areas;
  const cfgRow = await getActiveConfig(prop.company_id);
  if (!cfgRow) return;

  const { draftConfidence } = await import("@/lib/ml/confidence");
  const { computeEffectiveTurf, roundSqft } = await import("@/lib/geo/area");
  const rgbVeg = prop.grass_fraction != null ? Number(prop.grass_fraction) : null;
  const { level, why } = draftConfidence(pred.confidence, rgbVeg);
  const turf_sqft = roundSqft(computeEffectiveTurf(pred.service_areas, false));

  const [meas] = await db
    .insert(measurement)
    .values({
      property_id: propertyId,
      turf_sqft,
      bed_sqft: 0,
      complexity: "1.00",
      confidence: level,
      source: "ml_pred",
      service_areas: pred.service_areas,
      map_view: pred.map_view,
    })
    .returning();

  const result = computePricing(
    { turf_sqft, bed_sqft: 0, complexity: 1.0, confidence: level },
    toEngineConfig(cfgRow)
  );
  await db.insert(pricingResult).values({
    property_id: propertyId,
    measurement_id: meas.id,
    config_id: cfgRow.id,
    cost_per_visit: result.cost_per_visit,
    price_per_visit: result.price_per_visit,
    gross_profit_per_visit: result.gross_profit_per_visit,
    gross_margin_pct: result.gross_margin_pct,
    min_acceptable_price: result.min_acceptable_price,
    monthly_price: result.monthly_price,
    annual_price: result.annual_price,
    annual_gross_profit: result.annual_gross_profit,
    cole_annual_cut: result.cole_annual_cut,
    implied_per_acre_visit: result.implied_per_acre_visit,
    crew_hours_per_visit: result.crew_hours_per_visit,
    flags: result.flags,
    needs_review: result.needs_review,
  });
  console.log(`[turf-model] auto-drafted ${prop.name}: turf ${turf_sqft} sf (${pred.service_areas.features.length} polys) [${level}: ${why}]`);
}

/**
 * Detect buildings / parking / tree canopy inside the property's parcel from
 * OpenStreetMap (cached). Returns the suggestions for the map to drop in as
 * editable polygons. Empty array if there's no parcel or OSM has no coverage.
 */
export async function detectOsmFeatures(
  propertyId: string,
  force = false
): Promise<ServiceAreaFeature[]> {
  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop) return [];
  if (!force && prop.osm_features) return prop.osm_features as ServiceAreaFeature[];
  if (!prop.parcel_geojson) return [];

  const feats = await fetchOsmFeaturesInParcel(prop.parcel_geojson as ParcelResult);
  await db
    .update(property)
    .set({ osm_features: feats, updated_at: new Date() })
    .where(eq(property.id, propertyId));
  return feats;
}

/**
 * Estimate the serviceable (vegetated) area within the parcel from satellite
 * imagery (RGB vegetation detection). Returns an estimate + a mask overlay the
 * operator can audit, or null if there's no parcel/token.
 */
export async function estimateServiceableArea(
  propertyId: string
): Promise<ServiceableEstimate | null> {
  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop?.parcel_geojson) return null;
  return estimateServiceableAreaImpl(prop.parcel_geojson as ParcelResult, getMapboxToken());
}

export type GrassScreenResult = {
  grass_fraction: number;
  qualified: boolean;
  threshold: number;
  parcel_area_sqft: number;
};

/**
 * Sourcing pre-screen: cheaply estimate the parcel's vegetated (≈ grass) share
 * via RGB satellite detection, persist it to property.grass_fraction, and report
 * whether the property clears the MIN_GRASS_FRACTION gate. Geocodes + fetches the
 * parcel lazily if needed. Returns null if it can't be screened (no
 * address/coords/parcel/token). Cheap enough to batch-run over many candidates
 * before committing to a full measure pass.
 */
export async function screenProperty(propertyId: string): Promise<GrassScreenResult | null> {
  // Make sure we have coordinates and a parcel to screen within.
  await ensurePropertyGeocoded(propertyId);
  const parcel = await ensurePropertyParcel(propertyId);
  if (!parcel) return null;

  const estimate = await estimateServiceableAreaImpl(parcel, getMapboxToken());
  if (!estimate) return null;

  const fraction = estimate.vegetation_fraction;
  await db
    .update(property)
    .set({ grass_fraction: fraction, updated_at: new Date() })
    .where(eq(property.id, propertyId));

  revalidatePath(`/properties/${propertyId}`);
  revalidatePath("/dashboard");

  return {
    grass_fraction: fraction,
    qualified: isGrassQualified(fraction),
    threshold: MIN_GRASS_FRACTION,
    parcel_area_sqft: estimate.parcel_area_sqft,
  };
}

/**
 * Resolve the FREE ownership suggestion for a property: just the county parcel
 * owner-of-record (no Apollo, no credit). Cached in property.owner_suggestion.
 * A SUGGESTION only — never writes owner_org (build spec section 9). Safe to
 * call during render (no revalidatePath). Apollo enrichment is a separate,
 * explicit operator action (enrichOwnerWithApollo). Returns the suggestion or
 * null.
 */
export async function ensurePropertyOwnerSuggestion(
  propertyId: string
): Promise<OwnerSuggestion | null> {
  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop) return null;
  if (prop.owner_suggestion) return prop.owner_suggestion as OwnerSuggestion;

  // Need the parcel owner-of-record to seed the suggestion (no Apollo here).
  const parcel =
    (prop.parcel_geojson as ParcelResult | null) ?? (await ensurePropertyParcel(propertyId));
  const ownerName = parcel?.owner ?? null;
  if (!ownerName) return null;

  const suggestion = parcelSuggestion(ownerName);
  await db
    .update(property)
    .set({ owner_suggestion: suggestion, updated_at: new Date() })
    .where(eq(property.id, propertyId));
  return suggestion;
}

/**
 * Explicit operator action: enrich the owner-of-record via Apollo (spends ~1
 * Apollo credit on a match) and cache the canonical company. Never auto-runs —
 * triggered by the operator clicking "Enrich via Apollo".
 */
export async function enrichOwnerWithApollo(
  propertyId: string
): Promise<OwnerSuggestion | null> {
  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop) return null;
  const ownerName =
    (prop.parcel_geojson as ParcelResult | null)?.owner ??
    (prop.owner_suggestion as OwnerSuggestion | null)?.raw_owner ??
    null;
  if (!ownerName) return null;

  const suggestion = await enrichCompanyByName(ownerName);
  if (!suggestion) return null;
  await db
    .update(property)
    .set({ owner_suggestion: suggestion, updated_at: new Date() })
    .where(eq(property.id, propertyId));
  revalidatePath(`/properties/${propertyId}`);
  return suggestion;
}

/**
 * Operator confirms the suggested owner into owner_org (the operator-supplied
 * truth used for outreach). This is the only path that writes owner_org from a
 * suggestion — an explicit human action, satisfying the section 9 guardrail.
 */
export async function applyOwnerSuggestion(propertyId: string, name: string) {
  const clean = name.trim();
  if (!clean) return;
  await db
    .update(property)
    .set({ owner_org: clean, updated_at: new Date() })
    .where(eq(property.id, propertyId));
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath("/dashboard");
}

/**
 * Explicit operator action: resolve a free digital contact (OSM POI contact tags
 * + website scrape) for the property and cache it. No paid APIs, no auto-send.
 * The result is a suggestion the operator confirms via saveSuggestedContact.
 */
export async function findPropertyContact(
  propertyId: string
): Promise<ContactSuggestion | null> {
  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop) return null;
  const parcel =
    (prop.parcel_geojson as ParcelResult | null) ?? (await ensurePropertyParcel(propertyId));
  const suggestion = await findContact(parcel, [prop.name, prop.owner_org]);
  await db
    .update(property)
    .set({ contact_suggestion: suggestion ?? null, updated_at: new Date() })
    .where(eq(property.id, propertyId));
  revalidatePath(`/properties/${propertyId}`);
  return suggestion;
}

/**
 * Operator confirms a suggested contact into a real contact row (used by the
 * outreach step). Requires at least an email or phone. full_name falls back to
 * the owner org / a generic label since the table requires it.
 */
export async function saveSuggestedContact(
  propertyId: string,
  data: { name?: string | null; email?: string | null; phone?: string | null }
) {
  const email = data.email?.trim() || null;
  const phone = data.phone?.trim() || null;
  if (!email && !phone) return;
  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  const full_name = data.name?.trim() || prop?.owner_org?.trim() || "Site contact";
  await db.insert(contact).values({
    property_id: propertyId,
    full_name,
    email,
    phone,
    source: "manual",
  });
  revalidatePath(`/properties/${propertyId}`);
}

/** Force a re-fetch of the parcel (e.g. after the operator moves the pin). */
export async function refreshPropertyParcel(
  propertyId: string,
  lng: number,
  lat: number
): Promise<ParcelResult | null> {
  const parcel = await fetchParcelAtPoint(lng, lat);
  await db
    .update(property)
    .set({ parcel_geojson: parcel ?? null, lng, lat, updated_at: new Date() })
    .where(eq(property.id, propertyId));
  revalidatePath(`/properties/${propertyId}`);
  return parcel;
}

/**
 * Create (or refresh) the property's hosted proposal and return its slug. Links
 * the latest pricing result and re-derives the frequency/pricing options, so a
 * re-priced property's existing link shows the new numbers. Scope items persist
 * across refreshes. Advances pipeline to proposal_ready.
 */
export async function createOrUpdateProposal(propertyId: string): Promise<string> {
  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop) throw new Error("Property not found.");

  const [pr] = await db
    .select()
    .from(pricingResult)
    .where(eq(pricingResult.property_id, propertyId))
    .orderBy(desc(pricingResult.computed_at))
    .limit(1);
  if (!pr) throw new Error("Price the property before creating a proposal.");

  const cfgRow = await getActiveConfig(prop.company_id);
  const visits = cfgRow?.visits_per_year ?? 42;
  const freq = frequencyOptionsFromPricing(pr, visits);

  const [existing] = await db
    .select()
    .from(proposal)
    .where(eq(proposal.property_id, propertyId))
    .orderBy(desc(proposal.created_at))
    .limit(1);

  let slug: string;
  if (existing) {
    slug = existing.slug;
    await db
      .update(proposal)
      .set({
        pricing_result_id: pr.id,
        frequency_options: freq,
        updated_at: new Date(),
      })
      .where(eq(proposal.id, existing.id));
  } else {
    slug = makeProposalSlug(prop.name);
    await db.insert(proposal).values({
      property_id: propertyId,
      pricing_result_id: pr.id,
      slug,
      frequency_options: freq,
      scope_items: DEFAULT_SCOPE_ITEMS,
      status: "draft",
    });
  }

  if (prop.status === "sourced" || prop.status === "priced") {
    await db
      .update(property)
      .set({ status: "proposal_ready", updated_at: new Date() })
      .where(eq(property.id, propertyId));
  }
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath("/dashboard");
  return slug;
}

/**
 * Record an open of a hosted proposal: bump the counter, stamp first/last view,
 * mark viewed, and log a per-open row. Called from the public page on load; never
 * throws (a tracking failure must not break the recipient's view).
 */
export async function recordProposalView(slug: string, userAgent: string | null) {
  try {
    const [p] = await db.select().from(proposal).where(eq(proposal.slug, slug)).limit(1);
    if (!p) return;
    await db
      .update(proposal)
      .set({
        view_count: sql`${proposal.view_count} + 1`,
        last_viewed_at: new Date(),
        viewed_at: p.viewed_at ?? new Date(),
        status: p.status === "draft" || p.status === "sent" ? "viewed" : p.status,
        updated_at: new Date(),
      })
      .where(eq(proposal.id, p.id));
    await db.insert(proposalView).values({ proposal_id: p.id, user_agent: userAgent });
  } catch {
    // tracking is best-effort
  }
}

export type SendProposalResult =
  | { ok: true; to: string }
  | { ok: false; error: string };

/**
 * Send the hosted proposal link to the property's saved contact via Resend
 * (open/click tracking on). EXPLICIT operator action = the send approval (build
 * spec section 9). Guards: needs a proposal, a contact with email, the email not
 * suppressed, and Resend configured. Records an outreach row keyed by the Resend
 * message id so the webhook can attribute opens.
 */
export async function sendProposalEmail(propertyId: string): Promise<SendProposalResult> {
  if (!getResendKey()) return { ok: false, error: "Resend not configured (RESEND_API_KEY)." };

  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop) return { ok: false, error: "Property not found." };

  const [prop_] = await db
    .select()
    .from(proposal)
    .where(eq(proposal.property_id, propertyId))
    .orderBy(desc(proposal.created_at))
    .limit(1);
  if (!prop_) return { ok: false, error: "Create a proposal link first." };

  const [ct] = await db
    .select()
    .from(contact)
    .where(eq(contact.property_id, propertyId))
    .orderBy(desc(contact.created_at))
    .limit(1);
  const to = ct?.email?.trim();
  if (!ct || !to) return { ok: false, error: "Save a contact with an email first." };

  const [supp] = await db.select().from(suppression).where(eq(suppression.email, to)).limit(1);
  if (supp) return { ok: false, error: `${to} is on the suppression list.` };

  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  const link = `${base}/proposals/${prop_.slug}`;
  const [co] = await db.select().from(company).where(eq(company.id, prop.company_id)).limit(1);
  const subject = `Grounds maintenance proposal — ${prop.name}`;
  const html =
    `<p>Hi${ct.full_name ? ` ${ct.full_name.split(" ")[0]}` : ""},</p>` +
    `<p>We put together a grounds-maintenance proposal for <strong>${prop.name}</strong>. ` +
    `You can review it here:</p>` +
    `<p><a href="${link}">${link}</a></p>` +
    `<p>Happy to walk the property at your convenience.</p>` +
    (co?.name ? `<p>— ${co.name}</p>` : "") +
    (co?.physical_mailing_address
      ? `<hr/><p style="font-size:12px;color:#888">${co.name} · ${co.physical_mailing_address}</p>`
      : "");

  // Create the outreach row first so we can attach the message id after send.
  const [row] = await db
    .insert(outreach)
    .values({ property_id: propertyId, contact_id: ct.id, proposal_id: prop_.id, subject, body: html, status: "approved" })
    .returning();

  const sent = await sendEmail({ to, subject, html, tags: { outreach_id: row.id } });
  if (!sent.ok) {
    await db.update(outreach).set({ status: "draft", last_event: `send_failed: ${sent.error}`, updated_at: new Date() }).where(eq(outreach.id, row.id));
    return { ok: false, error: sent.error };
  }

  await db
    .update(outreach)
    .set({ status: "sent", resend_message_id: sent.id, sent_at: new Date(), updated_at: new Date() })
    .where(eq(outreach.id, row.id));
  await db.update(proposal).set({ status: "sent", updated_at: new Date() }).where(eq(proposal.id, prop_.id));
  if (
    prop.status === "proposal_ready" ||
    prop.status === "priced" ||
    prop.status === "sourced" ||
    prop.status === "outreach_drafted" // approval queue (/queue)
  ) {
    await db.update(property).set({ status: "sent", updated_at: new Date() }).where(eq(property.id, propertyId));
  }
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath("/dashboard");
  return { ok: true, to };
}

/** Operator-set buying signal: property is actively marketed / has a new PM. */
export async function setActivelyLeasing(propertyId: string, value: boolean) {
  await db
    .update(property)
    .set({ actively_leasing: value, updated_at: new Date() })
    .where(eq(property.id, propertyId));
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath("/dashboard");
}

/** Operator acknowledges the review flags (send gate, build spec section 6.2). */
export async function setAcknowledgedReview(propertyId: string, acknowledged: boolean) {
  await db
    .update(property)
    .set({ acknowledged_review: acknowledged, updated_at: new Date() })
    .where(eq(property.id, propertyId));
  revalidatePath(`/properties/${propertyId}`);
}

/**
 * Waterfall offer blast: email this lead to the nearest opted-in buyers
 * (nearest-first, capped at OFFER_MAX_RECIPIENTS). The 3-spot cap does the
 * locking; buyers who arrive late land on the dashboard's "filled — here's
 * the next best" fallback. Operator-triggered only (this is the approval).
 */
export async function offerLeadToBuyers(propertyId: string): Promise<void> {
  const back = (q: string): never => redirect(`/properties/${propertyId}?${q}`);
  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop) back("offer_err=" + encodeURIComponent("Property not found."));
  if (!prop!.parcel_geojson || prop!.archived_at || prop!.lead_exported_at) {
    back("offer_err=" + encodeURIComponent("Not sellable — needs a parcel and must be in circulation."));
  }
  const { leadAvailability, leadMaxBuyers } = await import("@/lib/leads/availability");
  const { TRADES, asTrade } = await import("@/lib/leads/trades");
  const { offerRecipients, leadKind: kindOf } = await import("@/lib/leads/market");
  const { signBuyerUnsub } = await import("@/lib/buyer-auth");

  // Spots are per trade; the blast is open as long as ANY trade that finds
  // this lead relevant still has room. Per-recipient copy uses their trade.
  const availByTrade = new Map(
    await Promise.all(
      (Object.keys(TRADES) as (keyof typeof TRADES)[]).map(
        async (t) => [t, await leadAvailability(prop!, t)] as const
      )
    )
  );
  const anyOpen = [...availByTrade.entries()].some(
    ([t, a]) => a.open && TRADES[t].relevant(kindOf(prop!.name))
  );
  if (!anyOpen) back("offer_err=" + encodeURIComponent("No spots left on this lead."));

  const allRecipients = await offerRecipients(prop!);
  // A buyer only gets the offer if their trade sees this lead AND their
  // trade's spots aren't gone.
  const recipients = allRecipients.filter(({ b }) => {
    const t = asTrade(b.trade);
    return TRADES[t].relevant(kindOf(prop!.name)) && (availByTrade.get(t)?.open ?? false);
  });
  if (!recipients.length) back("offer_err=" + encodeURIComponent("No opted-in buyers in range."));

  const base = (() => {
    const b = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    return b && !/localhost|127\.0\.0\.1/.test(b) ? b : "https://greenkeep.us";
  })();
  const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const { tradeValueInput } = await import("@/lib/leads/trades");
  const teaser = prop!.lead_teaser as { annual_lo?: number; annual_hi?: number } | null;
  const kind = kindOf(prop!.name);
  const kindLine =
    kind === "transfer"
      ? "The property just changed owners — new owners re-bid their vendors."
      : kind === "opening"
        ? "A new business is opening there — vendor decisions are being made now."
        : kind === "violation"
          ? "The city cited it for grounds/cleanup conditions — the owner must hire someone immediately."
          : kind === "distress"
            ? "The property is in the county tax-sale pipeline — cleanup is needed now, and the next owner re-bids every vendor."
            : kind === "rfp"
              ? "A government agency is taking bids on this contract — multi-year public money with a hard deadline."
              : "It's behind a new construction project — the first contract hasn't been won yet.";

  // LEAD INTEGRITY: every recipient reads the offer in THEIR trade's terms —
  // a security company gets a security contract at security value, never a
  // "grounds contract" with landscaping dollars. Landscaping keeps the
  // measured turf teaser; other trades use their county-records value model.
  const offerVoice = (t: ReturnType<typeof asTrade>): { valueTxt: string | null; noun: string } => {
    if (t === "landscaping") {
      return {
        valueTxt: teaser?.annual_lo
          ? `${usd(teaser.annual_lo)}–${usd(teaser.annual_hi ?? teaser.annual_lo)}/yr`
          : null,
        noun: "grounds contract",
      };
    }
    const est = TRADES[t].estimateValue(tradeValueInput(prop!, kind));
    return {
      valueTxt: est ? `${usd(est.annualLo)}–${usd(est.annualHi)}${est.per === "project" ? " project" : "/yr"}` : null,
      noun: `commercial ${TRADES[t].service} contract`,
    };
  };

  let sent = 0;
  for (const { b, miles } of recipients) {
    const voice = offerVoice(asTrade(b.trade));
    const subject = voice.valueTxt
      ? `First come, first served: ${voice.valueTxt} ${voice.noun}${prop!.city ? ` near ${prop!.city}` : ""}`
      : `First come, first served: a ${voice.noun}${prop!.city ? ` near ${prop!.city}` : ""}`;
    const unsubUrl = `${base}/api/unsubscribe?token=${encodeURIComponent(signBuyerUnsub(b.email))}`;
    const res = await sendEmail({
      to: b.email,
      subject,
      html:
        `<p>${b.company_name} — we're offering you a job${prop!.city ? ` in the ${prop!.city} area` : ""}${miles != null ? `, about ${Math.max(1, Math.round(miles))} mi from your office` : ""}:</p>` +
        `<p style="font-size:18px;font-weight:700;margin:8px 0">${voice.valueTxt ? `${voice.valueTxt} ${voice.noun}` : `A year-round ${voice.noun}`}</p>` +
        `<p>${kindLine}</p>` +
        `<p>Every job is capped at ${leadMaxBuyers()} companies* and this one is going to the ${recipients.length} closest — first come, first served. ${(availByTrade.get(asTrade(b.trade))?.spotsLeft ?? 0) === 1 ? "One spot is left." : `${availByTrade.get(asTrade(b.trade))?.spotsLeft ?? 0} spots are open right now.`}</p>` +
        `<p><a href="${base}/buyers?offer=${prop!.id}" style="display:inline-block;background:#2f7d4f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">See the job & claim a spot</a></p>` +
        `<p style="color:#666;font-size:13px">If it's gone by the time you get there, your dashboard will show you the next best open job near you.</p>` +
        `<p style="color:#888;font-size:12px">*The cap applies per service trade — full terms: ${base}/terms</p>` +
        `<p style="color:#888;font-size:12px">You get these because you turned on new-job alerts. ` +
        `<a href="${unsubUrl}">Unsubscribe with one click</a> or manage alerts in <a href="${base}/buyers">your dashboard</a>.</p>`,
      tags: { kind: "lead_offer" },
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (res.ok) sent++;
  }

  await db
    .update(property)
    .set({ offer_sent_at: new Date(), offer_sent_count: sent, updated_at: new Date() })
    .where(eq(property.id, propertyId));
  revalidatePath(`/properties/${propertyId}`);
  redirect(`/properties/${propertyId}?offered=${sent}`);
}
