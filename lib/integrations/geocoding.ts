// Mapbox geocoding. Server-only: uses the same MAPBOX_API token (a public pk.
// token is fine; it's never returned to the client from here). Turns a property
// address into [lng, lat] so the map can center on it.

/** [lng, lat] — GeoJSON/Mapbox coordinate order. */
export type LngLat = [number, number];

/** Default map center when an address can't be geocoded (NW Houston / Tomball). */
export const DEFAULT_CENTER: LngLat = [-95.6161, 30.0972];
export const DEFAULT_ZOOM = 18;

export function getMapboxToken(): string | null {
  const t = process.env.MAPBOX_API;
  return t && t.length > 0 ? t : null;
}

/**
 * Geocode a free-form address to [lng, lat]. Returns null on missing token,
 * empty address, network error, or no result — callers fall back to a draggable
 * pin at DEFAULT_CENTER.
 */
export async function geocodeAddress(address: string): Promise<LngLat | null> {
  const token = getMapboxToken();
  if (!token) return null;
  const query = address?.trim();
  if (!query) return null;

  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${encodeURIComponent(token)}&limit=1&country=us&types=address,poi`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { features?: Array<{ center?: number[] }> };
    const center = data.features?.[0]?.center;
    if (!center || center.length < 2) return null;
    return [center[0], center[1]];
  } catch {
    return null;
  }
}
