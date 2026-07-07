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
