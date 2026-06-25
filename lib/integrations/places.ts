// Integration seam (build spec section 12). Future autonomous property
// sourcing (e.g. Google Places) lands here so property.source can be "places".
// Not built in the MVP.

export interface PlacesCandidate {
  name: string;
  address: string;
  city?: string;
  zip?: string;
  lat?: number;
  lng?: number;
}

export async function searchPlaces(
  _query: string,
  _location?: { lat: number; lng: number; radius_m: number }
): Promise<PlacesCandidate[]> {
  throw new Error("NotImplemented: autonomous property sourcing is a future seam.");
}
