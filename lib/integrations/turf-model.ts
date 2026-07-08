// Client for the hosted turf-segmentation service (ml/serve.py). Given a
// property's parcel, fetch the same parcel-fit satellite tile the vegetation
// estimator uses, send it to the model endpoint, and get back kind-tagged
// service-area polygons (lng/lat) plus the model's self-assessed confidence.
//
// Configured via TURF_MODEL_URL (+ optional TURF_MODEL_KEY bearer). When unset,
// callers no-op — the app works exactly as before, model-less.

import area from "@turf/area";
import { fetchParcelTile } from "./imagery";
import { roundSqft, sqftFromM2, normalizeKind } from "../geo/area";
import type { MapView, ParcelResult, ServiceAreaCollection, ServiceAreaFeature } from "../geo/types";
import type { ModelConfidence } from "../ml/confidence";

export function getTurfModelUrl(): string | null {
  const u = (process.env.TURF_MODEL_URL ?? "").replace(/\/$/, "");
  return u.length > 0 ? u : null;
}

export type ModelPrediction = {
  service_areas: ServiceAreaCollection;
  confidence: ModelConfidence;
  map_view: MapView;
};

function parcelRings(p: ParcelResult): number[][][] {
  if (p.geometry.type === "Polygon") return [(p.geometry.coordinates as number[][][])[0]];
  return (p.geometry.coordinates as number[][][][]).map((poly) => poly[0]);
}

/**
 * Run the model on a parcel. Returns null when the endpoint isn't configured,
 * the tile can't be fetched, the request fails/times out, or the model found
 * nothing — callers treat null as "no draft". Never throws.
 */
export async function predictServiceAreas(
  parcel: ParcelResult,
  mapboxToken: string | null,
  existingLabels?: ServiceAreaCollection | null
): Promise<ModelPrediction | null> {
  const base = getTurfModelUrl();
  if (!base) return null;

  const tile = await fetchParcelTile(parcel, mapboxToken).catch(() => null);
  if (!tile) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000); // CPU inference can be slow
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const key = process.env.TURF_MODEL_KEY;
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(`${base}/predict`, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        image_b64: tile.jpeg.toString("base64"),
        width: tile.width,
        height: tile.height,
        bbox: { minLng: tile.minLng, minLat: tile.minLat, maxLng: tile.maxLng, maxLat: tile.maxLat },
        parcel_rings: parcelRings(parcel),
        existing_labels: existingLabels ?? null,
      }),
    });
    if (!res.ok) {
      console.warn(`[turf-model] predict ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const d = (await res.json()) as {
      features?: Array<{ properties?: { kind?: string }; geometry?: { type?: string; coordinates?: number[][][] } }>;
      confidence?: ModelConfidence;
    };
    const features: ServiceAreaFeature[] = (d.features ?? [])
      .filter((f) => f.geometry?.type === "Polygon" && (f.geometry.coordinates?.length ?? 0) > 0)
      .map((f) => {
        const feat: ServiceAreaFeature = {
          type: "Feature",
          properties: { kind: normalizeKind(f.properties?.kind), area_sqft: 0 },
          geometry: { type: "Polygon", coordinates: f.geometry!.coordinates! },
        };
        feat.properties.area_sqft = roundSqft(sqftFromM2(area(feat as GeoJSON.Feature)));
        return feat;
      });
    if (!features.length) return null;
    return {
      service_areas: { type: "FeatureCollection", features },
      confidence: d.confidence ?? { turf_margin: 0, mean_margin: 0, veg_frac: 0 },
      map_view: {
        center: [(tile.minLng + tile.maxLng) / 2, (tile.minLat + tile.maxLat) / 2],
        zoom: 17,
      },
    };
  } catch (e) {
    console.warn(`[turf-model] predict failed:`, e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- sports-turf screening ---------------------------------------------------
// The model over-predicts `sports_turf` (any big uniform green reads like a
// field). A real grass sports field only exists on certain properties, so the
// label must EARN its way in: the property's own context has to say sports are
// plausible, or OSM has to actually map a grass pitch there. Everything else
// gets demoted to plain turf — same mowable area, honest label.

/** Property context that makes a grass sports field plausible. */
const SPORTS_CONTEXT_RE =
  /school|\bisd\b|academy|college|university|campus|church|\bpark\b|athletic|sport|stadium|\bfield\b|ymca|recreation|little league|country club|swim|golf/i;

/** Does the property's own naming/ownership suggest sports fields? (pure) */
export function sportsContextAllows(contextText: string): boolean {
  return SPORTS_CONTEXT_RE.test(contextText);
}

/** Relabel every sports_turf feature as plain turf. (pure) */
export function demoteSportsTurf(sa: ServiceAreaCollection): {
  service_areas: ServiceAreaCollection;
  demoted: number;
} {
  let demoted = 0;
  const features = sa.features.map((f) => {
    if (f.properties.kind !== "sports_turf") return f;
    demoted++;
    return { ...f, properties: { ...f.properties, kind: "turf" as const } };
  });
  return { service_areas: { type: "FeatureCollection", features }, demoted };
}

/**
 * Keep sports_turf only where it's plausible: property context (name/owner)
 * suggests fields, or OSM maps a grass pitch on the parcel (authoritative;
 * checked only when the cheap context test fails, so most predictions never
 * hit Overpass). On any OSM failure the label demotes — a mislabeled sports
 * field is worse than a conservatively-labeled lawn.
 */
export async function screenSportsTurf(
  sa: ServiceAreaCollection,
  contextText: string,
  parcel: ParcelResult
): Promise<{ service_areas: ServiceAreaCollection; demoted: number }> {
  if (!sa.features.some((f) => f.properties.kind === "sports_turf")) {
    return { service_areas: sa, demoted: 0 };
  }
  if (sportsContextAllows(contextText)) return { service_areas: sa, demoted: 0 };
  try {
    const { searchSportsPois } = await import("./osm");
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const ring of parcelRings(parcel)) {
      for (const [lng, lat] of ring as [number, number][]) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    const pois = await searchSportsPois([minLat, minLng, maxLat, maxLng]);
    if (pois.length > 0) return { service_areas: sa, demoted: 0 };
  } catch {
    /* fall through to demote */
  }
  return demoteSportsTurf(sa);
}
