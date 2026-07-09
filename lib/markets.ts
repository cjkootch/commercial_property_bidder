// The market registry: everything metro-specific in ONE place, so opening
// a metro is a config entry + its data-source URLs, not a code hunt. Feeds
// take an explicit market (cron ?market=); prospecting infers the market
// from the LEAD's coordinates, so one deployment serves every metro at once.
// The MARKET env var only picks the default (houston).
//
// Deliberately NOT yet in the registry (Houston-only data adapters; wire per
// metro as needed): county parcel services (lib/integrations/parcel.ts
// queries the three Houston-area counties — other metros gracefully fall
// back to no-parcel value estimates), the permit/transfer feeds (HCAD and
// City of Houston datasets), and the 311 violations extract (Houston fire
// department's custom format; violations311Url is optional for that reason).

export type BonfirePortal = { slug: string; agency: string; city: string };

export type Market = {
  key: string;
  /** "Houston metro" — display. */
  label: string;
  /** Apollo location string for the metro-wide candidate pool. */
  metroSearch: string;
  /** Lowercased anchor city — the "already metro-wide" widen guard. */
  metroCity: string;
  /** [west, south, east, north] — assigns a lead to its market by coords. */
  bbox: [number, number, number, number];
  /** LGBS tax-sale county parameters (one fetch per county). */
  taxSaleCounties: string[];
  /** TABC pending-license county filters (one fetch per county). */
  tabcCounties: string[];
  /** City 311 export URL (violations feed) — Houston-format extracts only. */
  violations311Url?: string;
  /** Bonfire procurement portals serving public JSON (verify slugs live). */
  bonfirePortals: BonfirePortal[];
};

export const MARKETS: Record<string, Market> = {
  houston: {
    key: "houston",
    label: "Houston metro",
    metroSearch: "Houston, Texas",
    metroCity: "houston",
    bbox: [-96.2, 28.9, -94.4, 30.7],
    taxSaleCounties: ["HARRIS COUNTY"],
    tabcCounties: ["Harris"],
    violations311Url:
      "https://hfdapp.houstontx.gov/311/311-CRIS-Public-Data-Extract-D365-MTD-compressed.txt",
    bonfirePortals: [
      { slug: "harriscountytx", agency: "Harris County", city: "Houston" },
      { slug: "hccs", agency: "Houston Community College", city: "Houston" },
      { slug: "ridemetro", agency: "METRO (Harris County Transit)", city: "Houston" },
      { slug: "fortbendcountytx", agency: "Fort Bend County", city: "Richmond" },
      { slug: "galvestoncountytx", agency: "Galveston County", city: "Galveston" },
    ],
  },
  dallas: {
    key: "dallas",
    label: "Dallas–Fort Worth metro",
    metroSearch: "Dallas, Texas",
    metroCity: "dallas",
    bbox: [-97.9, 32.0, -96.0, 33.8],
    // LGBS carries both core DFW counties (verified live 2026-07-09:
    // 528 Dallas + 384 Tarrant parcels in the pipeline).
    taxSaleCounties: ["DALLAS COUNTY", "TARRANT COUNTY"],
    tabcCounties: ["Dallas", "Tarrant"],
    // No violations311Url: Dallas 311 is a Socrata dataset with a different
    // schema — needs its own adapter, not this URL slot.
    bonfirePortals: [
      // All five verified serving public JSON 2026-07-09.
      { slug: "dallascityhall", agency: "City of Dallas", city: "Dallas" },
      { slug: "fortworthtexas", agency: "City of Fort Worth", city: "Fort Worth" },
      { slug: "dart", agency: "DART (Dallas Area Rapid Transit)", city: "Dallas" },
      { slug: "dfwairport", agency: "DFW International Airport", city: "DFW Airport" },
      { slug: "arlingtontx", agency: "City of Arlington", city: "Arlington" },
    ],
  },
};

/** The deployment's default market (feeds without ?market=, UI defaults). */
export function currentMarket(): Market {
  const key = (process.env.MARKET ?? "houston").toLowerCase();
  return MARKETS[key] ?? MARKETS.houston;
}

/** Resolve an explicit market key (cron ?market=dallas); default on miss. */
export function marketByKey(key: string | null | undefined): Market {
  return (key && MARKETS[key.toLowerCase()]) || currentMarket();
}

/** Which market does this lead belong to? By coordinates, so prospecting
 *  pulls candidates from the LEAD's metro — not the deployment default. */
export function marketForCoords(lat: number | null | undefined, lng: number | null | undefined): Market {
  if (lat != null && lng != null) {
    for (const m of Object.values(MARKETS)) {
      const [w, s, e, n] = m.bbox;
      if (lng >= w && lng <= e && lat >= s && lat <= n) return m;
    }
  }
  return currentMarket();
}
