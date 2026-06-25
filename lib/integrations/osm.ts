// Near-term auto-detection of buildings & parking from OpenStreetMap (via the
// Overpass API). Deterministic, free, no ML. Building coverage is generally
// good in US suburbs; parking is spottier. Results are suggestions the operator
// adjusts on the map — and become labeled data for the future ML step.

import type { ParcelResult, ServiceAreaFeature } from "../geo/types";

// Multiple Overpass mirrors — the main endpoint frequently rate-limits (429 /
// HTML error pages). Try them in order until one returns JSON.
const OVERPASS_MIRRORS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

type LngLat = [number, number];

/** All outer rings of a parcel geometry, each [lng,lat][]. */
function parcelRings(p: ParcelResult): LngLat[][] {
  if (p.geometry.type === "Polygon") {
    return [(p.geometry.coordinates as number[][][])[0] as LngLat[]];
  }
  return (p.geometry.coordinates as number[][][][]).map((poly) => poly[0] as LngLat[]);
}

/** Bounding box [south, west, north, east] (lat/lng) for an Overpass query. */
function bboxOf(rings: LngLat[][]): [number, number, number, number] {
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  return [minLat, minLng, maxLat, maxLng];
}

/** Ray-casting point-in-polygon against a single ring. */
function pointInRing([x, y]: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInParcel(pt: LngLat, rings: LngLat[][]): boolean {
  return rings.some((r) => pointInRing(pt, r));
}

function ringCentroid(ring: LngLat[]): LngLat {
  let x = 0, y = 0;
  for (const [lng, lat] of ring) {
    x += lng;
    y += lat;
  }
  return [x / ring.length, y / ring.length];
}

type OverpassWay = {
  type: string;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
};

/**
 * Fetch OSM building & parking polygons whose centroid falls within the parcel.
 * Returns ServiceAreaFeatures tagged building|parking (area_sqft is filled by
 * the client on add). Resilient: returns [] on any error/timeout.
 */
export async function fetchOsmFeaturesInParcel(
  parcel: ParcelResult
): Promise<ServiceAreaFeature[]> {
  const rings = parcelRings(parcel);
  if (!rings.length) return [];
  // Buffer the parcel bbox (~55 m) so footprints that sit slightly outside the
  // county polygon — due to GIS/OSM positional offsets — are still detected.
  // The operator deletes any strays; better than returning nothing.
  const BUFFER_DEG = 0.0005;
  const [s0, w0, n0, e0] = bboxOf(rings);
  const [s, w, n, e] = [s0 - BUFFER_DEG, w0 - BUFFER_DEG, n0 + BUFFER_DEG, e0 + BUFFER_DEG];
  const inBufferedBbox = ([x, y]: LngLat) => x >= w && x <= e && y >= s && y <= n;
  const bb = `(${s},${w},${n},${e})`;
  const query =
    `[out:json][timeout:25];(` +
    `way["building"]${bb};` +
    `way["amenity"="parking"]${bb};` +
    `way["natural"="wood"]${bb};` +
    `way["landuse"="forest"]${bb};` +
    `way["natural"="scrub"]${bb};` +
    `);out geom;`;

  const elements = await overpassQuery(query);
  const out: ServiceAreaFeature[] = [];
  for (const el of elements) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 3) continue;
    const ring: LngLat[] = el.geometry.map((g) => [g.lon, g.lat]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    const c = ringCentroid(ring);
    if (!pointInParcel(c, rings) && !inBufferedBbox(c)) continue;
    const kind = kindFromTags(el.tags);
    if (!kind) continue;
    out.push({
      type: "Feature",
      properties: { kind, area_sqft: 0 },
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }
  return out;
}

function kindFromTags(tags?: Record<string, string>): "building" | "parking" | "tree" | null {
  if (!tags) return null;
  if (tags.building) return "building";
  if (tags.amenity === "parking") return "parking";
  if (tags.natural === "wood" || tags.landuse === "forest" || tags.natural === "scrub") {
    return "tree";
  }
  return null;
}

/** POST a query to each mirror until one returns valid JSON elements. */
async function overpassQuery(query: string): Promise<OverpassWay[]> {
  for (const url of OVERPASS_MIRRORS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal,
      });
      if (!res.ok) continue;
      const text = await res.text();
      try {
        const data = JSON.parse(text) as { elements?: OverpassWay[] };
        if (Array.isArray(data.elements)) return data.elements;
      } catch {
        continue; // HTML error page from a busy mirror
      }
    } catch {
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  return [];
}
