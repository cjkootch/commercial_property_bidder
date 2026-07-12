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
  /** Two-letter state postal code. Absent = "TX" (all the original metros);
   *  set explicitly once a non-Texas metro exists, so geocoding and copy can
   *  stop assuming Texas. */
  state?: string;
  /** Apollo location string for the metro-wide candidate pool. */
  metroSearch: string;
  /** Lowercased anchor city — the "already metro-wide" widen guard. */
  metroCity: string;
  /** IANA timezone for the metro's local wall clock (SMS send window, etc.).
   *  Absent = America/Chicago (Central) — every original Texas metro except
   *  El Paso, which is Mountain. */
  tz?: string;
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
  sanantonio: {
    key: "sanantonio",
    label: "San Antonio metro",
    metroSearch: "San Antonio, Texas",
    metroCity: "san antonio",
    // North edge 29.72: keeps New Braunfels (29.70) but cedes Hays County
    // (San Marcos/Kyle/Buda) to the Austin market — they're Austin MSA.
    bbox: [-99.1, 28.8, -97.9, 29.72],
    // LGBS is headquartered in San Antonio — Bexar is core territory
    // (verified live 2026-07-10: 66 properties in the pipeline).
    taxSaleCounties: ["BEXAR COUNTY"],
    tabcCounties: ["Bexar"],
    // No violations311Url: San Antonio 311 is a Socrata dataset — needs its
    // own adapter, same situation as Dallas.
    bonfirePortals: [
      // Verified serving public JSON 2026-07-10. The City of San Antonio and
      // Bexar County ALSO run Bonfire portals (sanantonio/bexar subdomains)
      // but both gate opportunity data behind login — re-probe occasionally.
      { slug: "nisd", agency: "Northside ISD", city: "San Antonio" },
      { slug: "saisd", agency: "San Antonio ISD", city: "San Antonio" },
      { slug: "schertz", agency: "City of Schertz", city: "Schertz" },
    ],
  },
  austin: {
    key: "austin",
    label: "Austin metro",
    metroSearch: "Austin, Texas",
    metroCity: "austin",
    // Includes Hays County (San Marcos/Kyle/Buda — Austin MSA) at the south.
    bbox: [-98.3, 29.72, -97.2, 30.9],
    // LGBS carries Hays but NOT Travis/Williamson (verified live 2026-07-10:
    // 18 Hays parcels, 0 for the other two — different delinquent-tax firms).
    taxSaleCounties: ["HAYS COUNTY"],
    // 83 pending applications across the three counties at probe time.
    tabcCounties: ["Travis", "Williamson", "Hays"],
    // No violations311Url: Austin 311 is a Socrata dataset — own adapter.
    bonfirePortals: [
      // Verified serving public JSON 2026-07-10. The City of Austin and
      // CapMetro don't run Bonfire portals under any probed slug.
      { slug: "austinisd", agency: "Austin ISD", city: "Austin" },
      { slug: "wilco", agency: "Williamson County", city: "Georgetown" },
      { slug: "roundrocktexas", agency: "City of Round Rock", city: "Round Rock" },
    ],
  },
  elpaso: {
    key: "elpaso",
    label: "El Paso metro",
    metroSearch: "El Paso, Texas",
    metroCity: "el paso",
    tz: "America/Denver", // El Paso is Mountain, not Central like the rest of TX.
    bbox: [-106.7, 31.4, -105.9, 32.1],
    // Verified live 2026-07-10: 55 parcels in the LGBS pipeline, 28 TABC
    // pending applications.
    taxSaleCounties: ["EL PASO COUNTY"],
    tabcCounties: ["El Paso"],
    bonfirePortals: [
      // The only El Paso-area Bonfire portal found (city/county/ISDs/Sun
      // Metro/EP Water all absent under every probed slug). Thin but real.
      { slug: "horizoncity", agency: "Town of Horizon City", city: "Horizon City" },
    ],
  },
  corpus: {
    key: "corpus",
    label: "Corpus Christi metro",
    metroSearch: "Corpus Christi, Texas",
    metroCity: "corpus christi",
    bbox: [-97.9, 27.4, -96.9, 28.2],
    // Probe kit 2026-07-10: 44 in the LGBS pipeline, 10 TABC pending.
    taxSaleCounties: ["NUECES COUNTY"],
    tabcCounties: ["Nueces"],
    bonfirePortals: [
      // Verified serving public JSON 2026-07-10 (portal titles checked).
      { slug: "ccisd", agency: "Corpus Christi ISD", city: "Corpus Christi" },
      { slug: "delmar", agency: "Del Mar College", city: "Corpus Christi" },
    ],
  },
  waco: {
    key: "waco",
    label: "Waco metro",
    metroSearch: "Waco, Texas",
    metroCity: "waco",
    bbox: [-97.6, 31.3, -96.8, 31.8],
    // Probe kit 2026-07-10: 31 in the LGBS pipeline, 9 TABC pending.
    taxSaleCounties: ["MCLENNAN COUNTY"],
    tabcCounties: ["McLennan"],
    // No Bonfire portals found under any probed slug (city/ISD/county/MCC) —
    // Waco-area agencies use other procurement platforms. Empty list = the
    // RFP cron no-ops for this market.
    bonfirePortals: [],
  },
  brownsville: {
    key: "brownsville",
    label: "Brownsville–Harlingen metro",
    metroSearch: "Brownsville, Texas",
    metroCity: "brownsville",
    // Cameron County (Brownsville/Harlingen/San Benito). Nearest market is
    // Corpus (south edge 27.4) — clear of this north edge by ~0.9°.
    bbox: [-97.87, 25.83, -97.15, 26.53],
    // Probe kit + OpenClaw sweep 2026-07-10: 85 in the LGBS pipeline,
    // 12 TABC pending.
    taxSaleCounties: ["CAMERON COUNTY"],
    tabcCounties: ["Cameron"],
    bonfirePortals: [
      // Verified serving public JSON 2026-07-10 (9 open at probe time). No
      // other Cameron-area agency (Harlingen, San Benito, county, ISDs)
      // answered any probed slug.
      { slug: "brownsvilletx", agency: "City of Brownsville", city: "Brownsville" },
    ],
  },
  beaumont: {
    key: "beaumont",
    label: "Beaumont–Port Arthur metro",
    metroSearch: "Beaumont, Texas",
    metroCity: "beaumont",
    // Jefferson County. West edge abuts Houston's east edge exactly (-94.4);
    // the overlap test allows shared edges, and the county sliver west of
    // -94.4 is empty marshland. East reaches the Orange county line.
    bbox: [-94.4, 29.5, -93.7, 30.2],
    // Probe kit + OpenClaw sweep 2026-07-10: 215 in the LGBS pipeline — the
    // biggest count outside Houston — and 11 TABC pending.
    taxSaleCounties: ["JEFFERSON COUNTY"],
    tabcCounties: ["Jefferson"],
    // No Bonfire portals found under any probed slug (city/county/ISDs/port)
    // — same situation as Waco. Empty list = the RFP cron no-ops.
    bonfirePortals: [],
  },
  // First non-Texas metro (2026-07-12, re-picked over Tampa per OpenClaw round 7
  // — Tampa's permit/code legs are dead in open data, Orlando's are Houston-grade).
  // Orange County, FL. The TX feed slots below are intentionally empty: Orlando
  // sources from FL-specific adapters (Socrata permits `ryhf-m453` + code
  // `k6e8-nw6w`, DBPR contractors CO_NO=58, RealAuction tax-deeds, FDOR parcels,
  // Tyler ssweb deeds) that plug in per leg — see
  // docs/market-research/orlando-build-plan.md. Bbox = Orange County extent
  // (City-of-Orlando launch; unincorporated county is a later expansion). No
  // overlap with any TX bbox.
  orlando: {
    key: "orlando",
    label: "Orlando metro",
    state: "FL",
    metroSearch: "Orlando, Florida",
    metroCity: "orlando",
    tz: "America/New_York", // Eastern.
    // Greater Orlando MSA, not just Orange County: distress (tax-deed /
    // foreclosure) properties spill into Osceola (Kissimmee ~28.29), Lake
    // (Mount Dora ~28.80) and Seminole, so the bbox must cover them or those
    // FL coords fall through to the deployment default. No other metro is near.
    bbox: [-81.95, 28.05, -80.75, 28.95],
    taxSaleCounties: [],
    tabcCounties: [],
    bonfirePortals: [],
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

/** Default metro timezone — Central, where a market's tz is unset. */
export const DEFAULT_TZ = "America/Chicago";

/** IANA timezone for the market a coordinate falls in (default Central). Used
 *  so automated SMS goes out on the RECIPIENT's local clock, not Texas time. */
export function marketTz(lat: number | null | undefined, lng: number | null | undefined): string {
  return marketForCoords(lat, lng).tz ?? DEFAULT_TZ;
}

/** The distinct timezones across all markets — the coarse gate for a run
 *  serving multiple metros; per-recipient checks use their own tz. */
export function marketTimezones(): string[] {
  return [...new Set(Object.values(MARKETS).map((m) => m.tz ?? DEFAULT_TZ))];
}
