// Scan a buyer's self-serve prospect: geocode → county parcel → satellite
// vegetation estimate → aerial snapshot → price (operator config estimate).
//
// Everything here is buyer-private and returned to the caller to persist onto
// the `prospect` row. It NEVER writes to `property`/`measurement`/`pricing_result`
// — that separation is what keeps buyer geometry out of the ML training export.

import { geocodeWithZip } from "../integrations/geocoding";
import { fetchParcelAtPoint } from "../integrations/parcel";
import {
  estimateServiceableArea,
  fetchParcelTile,
  type ServiceableEstimate,
} from "../integrations/imagery";
import { computePricing } from "../pricing/engine";
import type { Confidence, PricingConfig } from "../pricing/types";
import type { ParcelResult } from "../geo/types";
import type { DossierAerial } from "../leads/dossier";

/** Estimate band + headline figures derived from the pricing engine. */
export type ProspectPrice = {
  price_per_visit: number;
  monthly_price: number;
  annual_price: number;
  estimate_lo: number; // annual band low
  estimate_hi: number; // annual band high
};

/** The full result of scanning a prospect — artifacts to cache on the row. */
export type ProspectScan = {
  parcel: ParcelResult | null;
  aerial: DossierAerial | null;
  turf_sqft: number;
  bed_sqft: number;
  /** null when there's no active pricing config to estimate against. */
  price: ProspectPrice | null;
};

/** Geocode a free-form prospect address (+ optional city) to coords + ZIP. */
export async function geocodeProspect(
  address: string,
  city?: string | null
): Promise<{ lng: number; lat: number; zip: string | null } | null> {
  const query = [address, city, "TX"].map((s) => (s ?? "").trim()).filter(Boolean).join(", ");
  if (!query) return null;
  return geocodeWithZip(query, "address,poi");
}

/** Outer-ring coordinates of the parcel polygon(s), [lng,lat]. */
function parcelOuterRings(parcel: ParcelResult): [number, number][][] {
  const g = parcel.geometry;
  if (g.type === "Polygon") return [(g.coordinates as number[][][])[0] as [number, number][]];
  return (g.coordinates as number[][][][]).map((poly) => poly[0] as [number, number][]);
}

/**
 * Build the aerial snapshot (parcel-fit satellite tile + veg mask + parcel
 * outline in image pixels), stored as data URLs so the microsite and postcard
 * never re-spend imagery quota. Extracted from the lead dossier's aerial pass.
 */
export async function buildProspectAerial(
  parcel: ParcelResult,
  token: string | null,
  est: ServiceableEstimate | null
): Promise<DossierAerial | null> {
  const tile = await fetchParcelTile(parcel, token).catch(() => null);
  if (!tile) return null;
  const px = (lng: number) => ((lng - tile.minLng) / (tile.maxLng - tile.minLng)) * tile.width;
  const py = (lat: number) => ((tile.maxLat - lat) / (tile.maxLat - tile.minLat)) * tile.height;
  const outline = parcelOuterRings(parcel).map((ring) =>
    ring.map(([lng, lat]) => `${px(lng).toFixed(1)},${py(lat).toFixed(1)}`).join(" ")
  );
  return {
    image: `data:image/jpeg;base64,${tile.jpeg.toString("base64")}`,
    mask: est?.mask_data_url ?? null,
    width: tile.width,
    height: tile.height,
    outline,
  };
}

/** Pure re-price against the operator config. Estimate band is ±the annual. */
export function priceProspect(
  m: { turf_sqft: number; bed_sqft: number; complexity: number; confidence: Confidence },
  config: PricingConfig
): ProspectPrice {
  const r = computePricing(
    { turf_sqft: m.turf_sqft, bed_sqft: m.bed_sqft, complexity: m.complexity, confidence: m.confidence },
    config
  );
  return {
    price_per_visit: r.price_per_visit,
    monthly_price: r.monthly_price,
    annual_price: r.annual_price,
    estimate_lo: Math.round(r.annual_price * 0.9),
    estimate_hi: Math.round(r.annual_price * 1.15),
  };
}

/**
 * Full scan for a geocoded prospect: fetch the county parcel, estimate the
 * vegetated (≈ turf) area from imagery, build the aerial, and produce an initial
 * price. Writes nothing — the caller persists the artifacts. Returns a scan with
 * null parcel/aerial (and turf 0) when the county has no parcel there, so the
 * buyer can still draw the service area by hand on the map.
 */
export async function scanProspect(
  point: { lng: number; lat: number },
  config: PricingConfig | null,
  token: string | null
): Promise<ProspectScan> {
  const parcel = await fetchParcelAtPoint(point.lng, point.lat).catch(() => null);
  if (!parcel) {
    return { parcel: null, aerial: null, turf_sqft: 0, bed_sqft: 0, price: null };
  }
  const est = await estimateServiceableArea(parcel, token).catch(() => null);
  const aerial = await buildProspectAerial(parcel, token, est);
  const turf_sqft = est ? Math.round(est.turf_sqft) : 0;
  const bed_sqft = 0;
  const price = config
    ? priceProspect({ turf_sqft, bed_sqft, complexity: 1.0, confidence: "Med" }, config)
    : null;
  return { parcel, aerial, turf_sqft, bed_sqft, price };
}
