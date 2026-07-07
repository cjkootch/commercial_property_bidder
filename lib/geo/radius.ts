// Web-mercator helpers for the service-radius map. The static map is fixed at
// a zoom that fits the slider's MAX radius, so the SVG circle just scales with
// the slider (no image refetch). Center + client share these formulas.

export const MAP_PX = 512; // logical size of the static image box
export const MAX_RADIUS_MI = 60; // slider ceiling

const EARTH_M_PER_PX_Z0 = 156543.03392; // at the equator, zoom 0

/** Meters per logical pixel at a given latitude + zoom. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (EARTH_M_PER_PX_Z0 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** Zoom so a circle of `maxRadiusMi` fits within the image with margin. */
export function zoomForRadius(lat: number, maxRadiusMi = MAX_RADIUS_MI): number {
  const maxRadiusM = maxRadiusMi * 1609.34;
  // Want the max radius to span ~42% of the box (leaves a margin), i.e. fit
  // within (MAP_PX * 0.42) pixels.
  const targetPx = MAP_PX * 0.42;
  const mpp = maxRadiusM / targetPx;
  const z = Math.log2((EARTH_M_PER_PX_Z0 * Math.cos((lat * Math.PI) / 180)) / mpp);
  return Math.max(4, Math.min(15, Math.round(z * 100) / 100));
}

/** Pixels (in the logical MAP_PX box) per mile at a latitude + zoom. */
export function pixelsPerMile(lat: number, zoom: number): number {
  return 1609.34 / metersPerPixel(lat, zoom);
}
