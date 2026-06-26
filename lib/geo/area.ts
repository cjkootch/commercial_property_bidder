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
 * Overlap precedence, highest priority first. Where polygons overlap, the
 * region is counted toward the HIGHER-priority kind only — so a single large
 * `pavement` dropped over already-drawn turf/building/canopy doesn't
 * double-count: the precise feature wins and pavement fills only what's left
 * (the small grassy medians stay turf). This is what lets you trace the precise
 * features, then coarsely block in the parking lot.
 *
 * Tree vs. turf flips with `countTreeGrass`: when grass-under-trees counts as
 * mowable, turf outranks tree (canopy area stays priced); otherwise tree
 * outranks turf (canopy is carved out of the mowable area).
 */
export function precedenceFor(countTreeGrass: boolean): (typeof AREA_KINDS)[number][] {
  return countTreeGrass
    ? ["building", "bed", "turf", "tree", "pavement", "other"]
    : ["building", "bed", "tree", "turf", "pavement", "other"];
}

/**
 * Net (non-overlapping) area in sqft for every kind, resolving overlaps by
 * precedence: each kind's area excludes anything already claimed by a
 * higher-priority kind. Overlapping polygons of the SAME kind are also merged
 * (no double count). Falls back to the raw per-feature sums if a geometry op
 * fails, so it never blocks pricing.
 */
export function computeNetAreas(
  fc: ServiceAreaCollection | null | undefined,
  countTreeGrass: boolean
): AreaTotals["byKind"] {
  const polysByKind = new Map<string, Poly[]>();
  for (const f of fc?.features ?? []) {
    if (f.geometry?.type !== "Polygon" && f.geometry?.type !== "MultiPolygon") continue;
    const k = normalizeKind(f.properties?.kind);
    (polysByKind.get(k) ?? polysByKind.set(k, []).get(k)!).push(asPoly(f));
  }

  const net = Object.fromEntries(AREA_KINDS.map((k) => [k, 0])) as AreaTotals["byKind"];
  try {
    // Descend the precedence list, accumulating the union of everything already
    // claimed; each kind's net area is its own union minus that.
    let claimed: Poly | null = null;
    for (const kind of precedenceFor(countTreeGrass)) {
      const u = unionAll(polysByKind.get(kind) ?? []);
      if (!u) continue;
      const visible = claimed
        ? ((difference(featureCollection([u, claimed])) as Poly | null) ?? null)
        : u;
      net[kind] = visible ? sqftFromM2(area(visible)) : 0;
      claimed = claimed ? ((union(featureCollection([claimed, u])) as Poly | null) ?? claimed) : u;
    }
    return net;
  } catch {
    // Geometry op failed (e.g. self-intersecting polygon) — fall back to raw
    // per-feature sums so we never block pricing.
    return sumByKind(fc).byKind;
  }
}

/**
 * Mowable turf area (sqft) = the net turf area after overlap resolution: turf
 * minus any higher-priority building/bed (and tree canopy unless
 * `countTreeGrass`). Pavement does NOT subtract from turf — turf outranks it —
 * so a parking lot dropped over grass medians leaves the medians as turf.
 */
export function computeEffectiveTurf(
  fc: ServiceAreaCollection | null | undefined,
  countTreeGrass: boolean
): number {
  return computeNetAreas(fc, countTreeGrass).turf;
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
