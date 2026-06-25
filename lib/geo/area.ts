import area from "@turf/area";
import union from "@turf/union";
import difference from "@turf/difference";
import { featureCollection } from "@turf/helpers";
import {
  AREA_KINDS,
  type AreaKind,
  type AreaTotals,
  type ServiceAreaCollection,
  type ServiceAreaFeature,
} from "./types";

/** Normalize any stored/legacy kind to a current UI category. */
export function normalizeKind(v: unknown): (typeof AREA_KINDS)[number] {
  if (v === "parking" || v === "sidewalk") return "pavement"; // merged
  if (v === "exclude") return "other"; // legacy alias
  return (AREA_KINDS as readonly string[]).includes(v as string)
    ? (v as (typeof AREA_KINDS)[number])
    : "turf";
}

/** Square feet per square meter (Turf returns m²). */
export const M2_TO_SQFT = 10.7639104167;

export function sqftFromM2(m2: number): number {
  return m2 * M2_TO_SQFT;
}

/**
 * Sum drawn polygon areas by kind. Relies on each feature already carrying its
 * computed `area_sqft` (set client-side via @turf/area at draw time), so this
 * stays pure and testable without a geometry dependency.
 *
 * v1 caveats (surfaced in the UI): `exclude` polygons are annotation-only and
 * are NOT subtracted from turf/bed; overlapping same-kind polygons double-count.
 */
export function sumByKind(fc: ServiceAreaCollection | null | undefined): AreaTotals {
  const byKind = Object.fromEntries(AREA_KINDS.map((k) => [k, 0])) as AreaTotals["byKind"];
  for (const f of fc?.features ?? []) {
    const kind = normalizeKind(f.properties?.kind);
    byKind[kind] += Number(f.properties?.area_sqft) || 0;
  }
  const nonservice_sqft = byKind.building + byKind.pavement + byKind.other;
  return { turf_sqft: byKind.turf, bed_sqft: byKind.bed, byKind, nonservice_sqft };
}

/** Round a sqft value to a whole number for display/storage stability. */
export function roundSqft(n: number): number {
  return Math.round(n);
}

type Poly = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;

function asPoly(f: ServiceAreaFeature): Poly {
  return { type: "Feature", properties: {}, geometry: f.geometry as GeoJSON.Polygon };
}

function unionAll(features: Poly[]): Poly | null {
  if (!features.length) return null;
  let acc: Poly | null = features[0];
  for (let i = 1; i < features.length && acc; i++) {
    acc = union(featureCollection([acc, features[i]])) as Poly | null;
  }
  return acc;
}

/**
 * Mowable turf area (sqft) = the turf polygons MINUS the building/pavement/bed
 * polygons that overlap them, computed geometrically so it's correct whether
 * turf was drawn as the whole parcel or just the grass. Tree canopy is also
 * subtracted unless `countTreeGrass` (mowable grass under trees) is true.
 * Falls back to the raw turf area if the geometry op fails.
 */
export function computeEffectiveTurf(
  fc: ServiceAreaCollection | null | undefined,
  countTreeGrass: boolean
): number {
  const byKind = new Map<string, Poly[]>();
  for (const f of fc?.features ?? []) {
    if (f.geometry?.type !== "Polygon" && f.geometry?.type !== "MultiPolygon") continue;
    const k = normalizeKind(f.properties?.kind);
    (byKind.get(k) ?? byKind.set(k, []).get(k)!).push(asPoly(f));
  }
  const turfFeats = byKind.get("turf") ?? [];
  if (!turfFeats.length) return 0;

  const subtractKinds = ["building", "pavement", "bed", ...(countTreeGrass ? [] : ["tree"])];
  const subFeats = subtractKinds.flatMap((k) => byKind.get(k) ?? []);

  try {
    const turfUnion = unionAll(turfFeats);
    if (!turfUnion) return 0;
    const subUnion = unionAll(subFeats);
    if (!subUnion) return sqftFromM2(area(turfUnion));
    const mowable = difference(featureCollection([turfUnion, subUnion])) as Poly | null;
    return mowable ? sqftFromM2(area(mowable)) : 0;
  } catch {
    // Geometry op failed (e.g. self-intersecting polygon) — fall back to the
    // simple sum so we never block pricing.
    return sqftFromM2(turfFeats.reduce((s, f) => s + area(f), 0));
  }
}

const KIND_COLORS: Record<(typeof AREA_KINDS)[number], string> = {
  turf: "#3fae5a", // green
  bed: "#b9763f", // mulch brown
  tree: "#1f7a3d", // dark canopy green
  building: "#d1495b", // red
  pavement: "#475569", // asphalt slate (parking/sidewalk/driveway)
  other: "#9ca3af", // gray
};

const KIND_LABELS: Record<(typeof AREA_KINDS)[number], string> = {
  turf: "Turf",
  bed: "Bed",
  tree: "Tree canopy",
  building: "Building",
  pavement: "Pavement",
  other: "Other",
};

/** Fill color per kind, shared by the draw styles and read-only layer. */
export function colorForKind(kind: AreaKind): string {
  return KIND_COLORS[normalizeKind(kind)];
}

export function labelForKind(kind: AreaKind): string {
  return KIND_LABELS[normalizeKind(kind)];
}

export function isAreaKind(v: unknown): v is AreaKind {
  return v === "exclude" || (AREA_KINDS as readonly string[]).includes(v as string);
}

/** Type guard for a persisted/incoming service-area feature. */
export function isServiceAreaFeature(v: unknown): v is ServiceAreaFeature {
  return (
    !!v &&
    typeof v === "object" &&
    (v as { type?: string }).type === "Feature" &&
    (v as { geometry?: { type?: string } }).geometry?.type === "Polygon"
  );
}
