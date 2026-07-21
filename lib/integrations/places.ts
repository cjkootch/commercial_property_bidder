// Google Places discovery — the structural fix for Apollo pool exhaustion
// (2026-07-21: pages 1-5 of every worked metro consumed within a week;
// engines starved at 0-27 sends/day). Places' coverage of small route-based
// service businesses is far deeper than Apollo's B2B graph, and every result
// carries a PHONE — which feeds the SMS lane, the channel that actually gets
// replies. Used as a FALLBACK when Apollo's fresh-candidate stream runs dry,
// so Apollo (which has websites → scrapeable emails) still leads.
//
// (This file was the old "future property sourcing" seam — repurposed for
// BUYER discovery; property sourcing via Places remains unbuilt.)
//
// Cost: Text Search Pro SKU ~$32/1k requests, first ~$200/mo free. The 2h
// memo + shortage-only triggering keeps volume in the free tier.
// Env: GOOGLE_PLACES_API_KEY (absent → [] — engines just skip the fallback).

export type PlaceCandidate = {
  name: string;
  website: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
};

type RawPlace = {
  displayName?: { text?: string };
  websiteUri?: string;
  nationalPhoneNumber?: string;
  addressComponents?: Array<{ types?: string[]; shortText?: string; longText?: string }>;
};

/** Pure parser, unit-testable: raw Places API shape → candidate. */
export function parsePlace(p: RawPlace): PlaceCandidate | null {
  const name = p.displayName?.text?.trim();
  if (!name) return null;
  const comp = (type: string) => p.addressComponents?.find((c) => c.types?.includes(type)) ?? null;
  return {
    name,
    website: p.websiteUri ?? null,
    city: comp("locality")?.longText ?? null,
    state: comp("administrative_area_level_1")?.shortText ?? null,
    phone: p.nationalPhoneNumber ?? null,
  };
}

const memo = new Map<string, { at: number; data: PlaceCandidate[] }>();
const MEMO_TTL_MS = 2 * 3600_000;

/**
 * Text search for service companies (e.g. "landscaping companies in Katy,
 * Texas"). Memoized 2h per query so repeat waves don't re-bill. Never throws.
 */
export async function searchPlacesCompanies(textQuery: string, maxResults = 20): Promise<PlaceCandidate[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return [];
  const memoKey = `${textQuery}|${maxResults}`;
  const hit = memo.get(memoKey);
  if (hit && Date.now() - hit.at < MEMO_TTL_MS) return [...hit.data];
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        // FieldMask bounds the bill: only the fields discovery needs.
        "X-Goog-FieldMask":
          "places.displayName,places.websiteUri,places.nationalPhoneNumber,places.addressComponents",
      },
      body: JSON.stringify({ textQuery, pageSize: Math.min(maxResults, 20) }),
    });
    if (!res.ok) {
      console.error(`places searchText ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return [];
    }
    const data = (await res.json()) as { places?: RawPlace[] };
    const out = (data.places ?? []).map(parsePlace).filter(Boolean) as PlaceCandidate[];
    if (out.length > 0) {
      if (memo.size > 50) memo.clear();
      memo.set(memoKey, { at: Date.now(), data: out });
    }
    return [...out];
  } catch (e) {
    console.error("places searchText failed:", e);
    return [];
  }
}
