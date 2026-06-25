import {
  AREA_KINDS,
  type AreaKind,
  type AreaTotals,
  type ServiceAreaCollection,
  type ServiceAreaFeature,
} from "./types";

/** Normalize any stored/legacy kind to a current UI category. */
export function normalizeKind(v: unknown): (typeof AREA_KINDS)[number] {
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
  const nonservice_sqft =
    byKind.building + byKind.parking + byKind.sidewalk + byKind.other;
  return { turf_sqft: byKind.turf, bed_sqft: byKind.bed, byKind, nonservice_sqft };
}

/** Round a sqft value to a whole number for display/storage stability. */
export function roundSqft(n: number): number {
  return Math.round(n);
}

const KIND_COLORS: Record<(typeof AREA_KINDS)[number], string> = {
  turf: "#3fae5a", // green
  bed: "#b9763f", // mulch brown
  building: "#d1495b", // red
  parking: "#475569", // asphalt slate
  sidewalk: "#cbd5e1", // light concrete
  other: "#9ca3af", // gray
};

const KIND_LABELS: Record<(typeof AREA_KINDS)[number], string> = {
  turf: "Turf",
  bed: "Bed",
  building: "Building",
  parking: "Parking",
  sidewalk: "Sidewalk",
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
