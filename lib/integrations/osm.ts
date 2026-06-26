// Near-term auto-detection of buildings & parking from OpenStreetMap (via the
// Overpass API). Deterministic, free, no ML. Building coverage is generally
// good in US suburbs; parking is spottier. Results are suggestions the operator
// adjusts on the map — and become labeled data for the future ML step.

import type { ParcelResult, ServiceAreaFeature } from "../geo/types";
import { orthogonalizeRing } from "../geo/orthogonalize";

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
  /** Present on ways/relations when queried with `out center`. */
  center?: { lat: number; lon: number };
  lat?: number;
  lon?: number;
};

export type PoiCandidate = {
  name: string;
  lng: number;
  lat: number;
  icp_type: "church" | "daycare" | "office_park" | "medical" | "other";
  osm: string;
};

/** Map an OSM amenity tag to one of our ICP types (grass-likely commercial). */
function icpFromAmenity(tags: Record<string, string>): PoiCandidate["icp_type"] | null {
  const a = tags.amenity;
  if (a === "place_of_worship") return "church";
  if (a === "kindergarten" || a === "childcare") return "daycare";
  if (a === "school" || a === "college") return "other";
  if (a === "community_centre") return "other";
  if (tags.office) return "office_park";
  if (a === "clinic" || a === "hospital" || tags.healthcare) return "medical";
  return null;
}

/**
 * Discover candidate commercial properties (grass-likely ICP types: churches,
 * schools, daycares, community centres, offices, clinics) within a bbox, for the
 * sourcing pipeline. bbox is [south, west, north, east]. Returns named POIs with
 * a representative point; the caller resolves parcels and screens grass coverage.
 */
export async function searchCommercialPois(
  bbox: [number, number, number, number]
): Promise<PoiCandidate[]> {
  const [s, w, n, e] = bbox;
  const bb = `(${s},${w},${n},${e})`;
  const query =
    `[out:json][timeout:60];(` +
    `nwr["amenity"="place_of_worship"]${bb};` +
    `nwr["amenity"="school"]${bb};` +
    `nwr["amenity"="kindergarten"]${bb};` +
    `nwr["amenity"="community_centre"]${bb};` +
    `nwr["amenity"="clinic"]${bb};` +
    `);out center tags;`;

  const elements = await overpassQuery(query);
  const out: PoiCandidate[] = [];
  const seenNames = new Set<string>();
  for (const el of elements) {
    const tags = el.tags;
    if (!tags?.name) continue;
    const icp = icpFromAmenity(tags);
    if (!icp) continue;
    const lat = el.center?.lat ?? el.lat;
    const lon = el.center?.lon ?? el.lon;
    if (lat == null || lon == null) continue;
    const key = tags.name.trim().toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    out.push({ name: tags.name.trim(), lng: lon, lat, icp_type: icp, osm: `${el.type}` });
  }
  return out;
}

/** Title-case an OSM tag value like "american_football" → "American Football". */
function prettySport(v?: string): string | null {
  if (!v) return null;
  return v
    .split(/[_;]/)[0]
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Discover candidate properties that are LIKELY TO CONTAIN SPORTS TURF (athletic
 * fields) within a bbox — for building up `sports_turf` training labels. Targets
 * leisure=pitch / stadium / sports_centre / track and parks. Unnamed pitches get
 * a synthesized, coordinate-unique name so the sourcing dedup still works.
 * bbox is [south, west, north, east].
 */
export async function searchSportsPois(
  bbox: [number, number, number, number]
): Promise<PoiCandidate[]> {
  const [s, w, n, e] = bbox;
  const bb = `(${s},${w},${n},${e})`;
  const query =
    `[out:json][timeout:60];(` +
    `nwr["leisure"="pitch"]${bb};` +
    `nwr["leisure"="stadium"]${bb};` +
    `nwr["leisure"="sports_centre"]${bb};` +
    `nwr["leisure"="track"]${bb};` +
    `nwr["leisure"="park"]["sport"]${bb};` +
    `);out center tags;`;

  // Natural-grass field sports (mowable turf); court/sand/hard sports excluded.
  const GRASS_SPORTS = new Set([
    "soccer", "football", "american_football", "baseball", "softball", "rugby",
    "rugby_union", "rugby_league", "field_hockey", "lacrosse", "cricket",
    "australian_football", "gaelic_games", "multi",
  ]);
  const HARD_SURFACES = new Set([
    "clay", "asphalt", "concrete", "hard", "sand", "acrylic", "tartan",
    "paving_stones", "artificial_turf", "rubber", "dirt",
  ]);

  const elements = await overpassQuery(query);
  const out: PoiCandidate[] = [];
  const seenNames = new Set<string>();
  for (const el of elements) {
    const tags = el.tags;
    if (!tags) continue;
    const lat = el.center?.lat ?? el.lat;
    const lon = el.center?.lon ?? el.lon;
    if (lat == null || lon == null) continue;
    // Keep only natural-grass field sports: grass surface, OR a known grass sport
    // that isn't tagged with a hard/sand surface. Stadiums/sports centres pass
    // (mixed venues) for the operator to judge.
    const surface = (tags.surface ?? "").toLowerCase();
    const sportRaw = (tags.sport ?? "").split(/[_;]/)[0].toLowerCase();
    const isVenue = tags.leisure === "stadium" || tags.leisure === "sports_centre";
    const grassy =
      surface === "grass" ||
      (GRASS_SPORTS.has(sportRaw) && !HARD_SURFACES.has(surface)) ||
      (isVenue && !HARD_SURFACES.has(surface));
    if (!grassy) continue;
    // Prefer a real name; otherwise synthesize "<Sport> Field @lat,lng" so reruns
    // dedup and unnamed pitches still flow through the pipeline.
    const sport = prettySport(tags.sport);
    const name =
      tags.name?.trim() ||
      `${sport ?? "Sports"} Field @${lat.toFixed(4)},${lon.toFixed(4)}`;
    const key = name.toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    out.push({ name, lng: lon, lat, icp_type: "other", osm: `${el.type}` });
  }
  return out;
}

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
  // Query the parcel bbox, then keep only features that actually fall inside the
  // parcel polygon — so we never pull in a neighbor's footprints.
  const [s, w, n, e] = bboxOf(rings);
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
    // Strict: the footprint's centroid must be within the parcel boundary.
    if (!pointInParcel(ringCentroid(ring), rings)) continue;
    const kind = kindFromTags(el.tags);
    if (!kind) continue;
    // Snap building footprints to clean right angles; leave organic shapes
    // (parking lots, tree canopy) as traced.
    const coordinates = kind === "building" ? [orthogonalizeRing(ring)] : [ring];
    out.push({
      type: "Feature",
      properties: { kind, area_sqft: 0 },
      geometry: { type: "Polygon", coordinates },
    });
  }
  return out;
}

export type OsmContact = {
  name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  operator: string | null;
};

/**
 * Pull contact tags (phone/email/website/operator) from the most prominent named
 * POI inside the parcel. Free, deterministic. Returns null if OSM has no POI with
 * usable contact info there. Prefers a POI that actually has a phone/email/site.
 */
export async function fetchContactTagsInParcel(parcel: ParcelResult): Promise<OsmContact | null> {
  const rings = parcelRings(parcel);
  if (!rings.length) return null;
  const [s, w, n, e] = bboxOf(rings);
  const bb = `(${s},${w},${n},${e})`;
  // Any named feature in the parcel that might carry contact info.
  const query = `[out:json][timeout:25];(nwr["name"]${bb};);out center tags;`;

  const elements = await overpassQuery(query);
  const candidates: OsmContact[] = [];
  for (const el of elements) {
    const tags = el.tags;
    if (!tags?.name) continue;
    const lat = el.center?.lat ?? el.lat;
    const lon = el.center?.lon ?? el.lon;
    if (lat == null || lon == null) continue;
    if (!pointInParcel([lon, lat], rings)) continue;
    candidates.push({
      name: tags.name?.trim() ?? null,
      phone: (tags.phone ?? tags["contact:phone"] ?? null)?.trim() ?? null,
      email: (tags.email ?? tags["contact:email"] ?? null)?.trim() ?? null,
      website: (tags.website ?? tags["contact:website"] ?? null)?.trim() ?? null,
      operator: tags.operator?.trim() ?? null,
    });
  }
  if (!candidates.length) return null;
  // Prefer a candidate that actually has reachable contact info.
  const withContact = candidates.find((c) => c.phone || c.email || c.website);
  return withContact ?? candidates[0];
}

function kindFromTags(tags?: Record<string, string>): "building" | "pavement" | "tree" | null {
  if (!tags) return null;
  if (tags.building) return "building";
  if (tags.amenity === "parking") return "pavement";
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
