// The market registry: everything metro-specific in ONE place, so opening
// metro #2 (DFW, San Antonio, Austin) is a config entry + its data-source
// URLs, not a code hunt. Feeds and prospecting read currentMarket(); the
// MARKET env var selects it (default houston).
//
// Deliberately NOT yet in the registry (single-market simplifications, wire
// when metro #2 is real): county parcel services (lib/integrations/parcel.ts
// queries all three Houston-area counties in parallel), the TABS permit feed
// (statewide with regional filtering inside the integration), and the TABC
// SODA dataset (statewide; the county filter below scopes it).

export type BonfirePortal = { slug: string; agency: string; city: string };

export type Market = {
  key: string;
  /** "Houston metro" — display. */
  label: string;
  /** Apollo location string for the metro-wide candidate pool. */
  metroSearch: string;
  /** Lowercased anchor city — the "already metro-wide" widen guard. */
  metroCity: string;
  /** LGBS tax-sale county parameter. */
  taxSaleCounty: string;
  /** TABC pending-license county filter. */
  tabcCounty: string;
  /** City 311 export URL (violations feed). */
  violations311Url: string;
  /** Bonfire procurement portals serving public JSON. */
  bonfirePortals: BonfirePortal[];
};

export const MARKETS: Record<string, Market> = {
  houston: {
    key: "houston",
    label: "Houston metro",
    metroSearch: "Houston, Texas",
    metroCity: "houston",
    taxSaleCounty: "HARRIS COUNTY",
    tabcCounty: "Harris",
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
};

export function currentMarket(): Market {
  const key = (process.env.MARKET ?? "houston").toLowerCase();
  return MARKETS[key] ?? MARKETS.houston;
}
