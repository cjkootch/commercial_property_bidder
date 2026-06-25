import type {
  AreaKind,
  AreaTotals,
  ServiceAreaCollection,
  ServiceAreaFeature,
} from "./types";

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
  const totals: AreaTotals = { turf_sqft: 0, bed_sqft: 0, exclude_sqft: 0 };
  if (!fc?.features?.length) return totals;
  for (const f of fc.features) {
    const kind: AreaKind = f.properties?.kind ?? "turf";
    const a = Number(f.properties?.area_sqft) || 0;
    if (kind === "turf") totals.turf_sqft += a;
    else if (kind === "bed") totals.bed_sqft += a;
    else totals.exclude_sqft += a;
  }
  return totals;
}

/** Round a sqft value to a whole number for display/storage stability. */
export function roundSqft(n: number): number {
  return Math.round(n);
}

/** Default fill color per kind, shared by the draw styles and read-only layer. */
export function colorForKind(kind: AreaKind): string {
  switch (kind) {
    case "turf":
      return "#3fae5a"; // green
    case "bed":
      return "#b9763f"; // mulch brown
    default:
      return "#9ca3af"; // gray (exclude)
  }
}

export function isAreaKind(v: unknown): v is AreaKind {
  return v === "turf" || v === "bed" || v === "exclude";
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
