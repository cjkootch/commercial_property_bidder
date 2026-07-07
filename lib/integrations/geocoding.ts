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

/** A single address autocomplete suggestion. */
export type AddressSuggestion = { label: string; lng: number; lat: number };

/**
 * Address autocomplete for the instant-quote bar. Returns up to 5 US address
 * suggestions (with coords, so a pick can skip re-geocoding). Empty on missing
 * token, short query, network error, or no result.
 */
export async function suggestAddresses(query: string): Promise<AddressSuggestion[]> {
  const token = getMapboxToken();
  if (!token) return [];
  const q = query?.trim();
  if (!q || q.length < 3) return [];

  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
    `?access_token=${encodeURIComponent(token)}&autocomplete=true&limit=5&country=us&types=address`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: Array<{ place_name?: string; center?: number[] }> };
    return (data.features ?? [])
      .filter((f) => f.center && f.center.length >= 2 && f.place_name)
      .map((f) => ({ label: f.place_name as string, lng: f.center![0], lat: f.center![1] }));
  } catch {
    return [];
  }
}

/**
 * Geocode a free-form address to [lng, lat]. Returns null on missing token,
 * empty address, network error, or no result — callers fall back to a draggable
 * pin at DEFAULT_CENTER.
 */
export async function geocodeAddress(
  address: string,
  /** Mapbox feature types. Default suits street addresses; pass
   *  "place,address,poi" when the query may be just a city name. */
  types = "address,poi"
): Promise<LngLat | null> {
  const token = getMapboxToken();
  if (!token) return null;
  const query = address?.trim();
  if (!query) return null;

  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${encodeURIComponent(token)}&limit=1&country=us&types=${encodeURIComponent(types)}`;

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

/** Driving time/distance between two [lng,lat] points (Mapbox Directions). */
export async function fetchDriveTime(
  from: [number, number],
  to: [number, number]
): Promise<{ minutes: number; miles: number } | null> {
  const token = getMapboxToken();
  if (!token) return null;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/` +
    `${from[0]},${from[1]};${to[0]},${to[1]}` +
    `?access_token=${encodeURIComponent(token)}&overview=false`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { routes?: Array<{ duration: number; distance: number }> };
    const r = data.routes?.[0];
    if (!r) return null;
    return { minutes: Math.round(r.duration / 60), miles: Math.round((r.distance / 1609.34) * 10) / 10 };
  } catch {
    return null;
  }
}
