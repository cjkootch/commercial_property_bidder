import { AREA_KINDS, type ServiceAreaCollection } from "./types";
import { normalizeKind, precedenceFor } from "./area";

type UiKind = (typeof AREA_KINDS)[number];

// Per-pixel class indices for segmentation masks. 0 = background (unlabeled).
export const CLASS_INDEX: Record<(typeof AREA_KINDS)[number], number> = {
  turf: 1,
  bed: 2,
  tree: 3,
  building: 4,
  pavement: 5,
  other: 6,
};

export const CLASS_NAMES = [
  "background",
  "turf",
  "bed",
  "tree",
  "building",
  "pavement",
  "other",
] as const;

export type RasterBounds = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  width: number;
  height: number;
};

function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Point in a GeoJSON Polygon (outer ring minus holes). */
function pointInPolygon(x: number, y: number, coords: number[][][]): boolean {
  if (!coords.length || !pointInRing(x, y, coords[0])) return false;
  for (let h = 1; h < coords.length; h++) {
    if (pointInRing(x, y, coords[h])) return false; // inside a hole
  }
  return true;
}

// Paint order: later kinds override earlier where polygons overlap, so this is
// the overlap precedence (area.ts) reversed — lowest priority first, highest
// last. Critically, turf outranks pavement: a parking lot dropped over grass
// medians leaves the medians as turf in the mask, matching the priced area.
const PAINT_ORDER: UiKind[] = [...precedenceFor(false)].reverse();

/**
 * Rasterize labeled service-area polygons into a class-index mask aligned to a
 * satellite tile's geographic bounds. Returns a Uint8Array of width*height with
 * values from CLASS_INDEX (0 = background). Pixel centers are tested against
 * each polygon; kinds are painted in PAINT_ORDER so overlaps resolve sensibly.
 */
export function rasterizeMask(
  fc: ServiceAreaCollection | null | undefined,
  b: RasterBounds
): Uint8Array {
  const mask = new Uint8Array(b.width * b.height);
  if (!fc?.features?.length) return mask;

  const latSpan = b.maxLat - b.minLat;
  const lngSpan = b.maxLng - b.minLng;

  for (const kind of PAINT_ORDER) {
    const feats = fc.features.filter((f) => normalizeKind(f.properties?.kind) === kind);
    if (!feats.length) continue;
    const ci = CLASS_INDEX[kind];
    for (let py = 0; py < b.height; py++) {
      const lat = b.maxLat - ((py + 0.5) * latSpan) / b.height;
      for (let px = 0; px < b.width; px++) {
        const lng = b.minLng + ((px + 0.5) * lngSpan) / b.width;
        for (const f of feats) {
          if (pointInPolygon(lng, lat, f.geometry.coordinates)) {
            mask[py * b.width + px] = ci;
            break;
          }
        }
      }
    }
  }
  return mask;
}

/** Count pixels per class index (length = CLASS_NAMES.length). */
export function classPixelCounts(mask: Uint8Array): number[] {
  const counts = new Array(CLASS_NAMES.length).fill(0);
  for (let i = 0; i < mask.length; i++) counts[mask[i]]++;
  return counts;
}
