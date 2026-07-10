// County parcel boundaries + owner-of-record via free public ArcGIS services
// (build spec section 12 parcel seam). Covers the NW-Houston target area:
//   - Harris County (Tomball / Spring / Cypress) — HCAD
//   - Montgomery County (Magnolia / Conroe) — MCAD via City of Conroe
//
// This NEVER auto-fills property.owner_org; the resolved owner is only a
// suggestion for the operator to confirm (build spec section 9).

import type { ParcelResult } from "../geo/types";

type ArcGisFeature = {
  geometry?: { type: string; coordinates: unknown };
  properties?: Record<string, unknown>;
};

type CountyService = {
  county: string;
  /** ArcGIS layer query endpoint (…/MapServer/<id>). */
  url: string;
  /** Map a raw ArcGIS feature's attributes into the normalized fields. */
  normalize: (p: Record<string, unknown>) => {
    owner: string | null;
    parcel_id: string | null;
    address: string | null;
    acres: number | null;
    last_sale_date?: string | null;
    market_value?: number | null;
    owner_mailing_address?: string | null;
    building_sqft?: number | null;
    improvement_value?: number | null;
    land_sqft?: number | null;
    state_class?: string | null;
    land_use?: string | null;
  };
};

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}
function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
/** ArcGIS epoch-millis (or a date string) -> ISO date (YYYY-MM-DD), or null. */
function dateOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  const d = Number.isFinite(n) ? new Date(n) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const COUNTY_SERVICES: CountyService[] = [
  {
    county: "Harris",
    url: "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0",
    normalize: (p) => ({
      owner: str(p.owner_name_1),
      parcel_id: str(p.HCAD_NUM) ?? str(p.acct_num),
      address:
        str(p.site_addr_1) ??
        (str(
          [str(p.site_str_num), str(p.site_str_pfx), str(p.site_str_name)]
            .filter(Boolean)
            .join(" ")
        )),
      // Acreage is a STRING on this layer ("2.2137 AC") — prefer the numeric
      // twin, else parse the leading number (Number() alone yields NaN).
      acres: numOrNull(p.acreage_1) ?? (Number.parseFloat(String(p.Acreage)) || null),
      last_sale_date: dateOrNull(p.new_owner_date),
      market_value: numOrNull(p.total_market_val),
      owner_mailing_address: str(
        [
          [str(p.mail_addr_1), str(p.mail_addr_2)].filter(Boolean).join(" "),
          str(p.mail_city),
          [str(p.mail_state), str(p.mail_zip)].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(", ")
      ),
      // Trade value drivers (per-trade estimateValue models read these).
      building_sqft: numOrNull(p.nra) || null, // 0 means "not stated"
      improvement_value: numOrNull(p.impr_value) || null,
      land_sqft: numOrNull(p.land_sqft) || null,
      state_class: str(p.state_class),
      land_use: str(p.land_use),
    }),
  },
  {
    county: "Montgomery",
    url: "https://maps.cityofconroe.org/cvharcgis/rest/services/ENG/MANAGE_KML_TAX_PARCELS_1051_WGS84/MapServer/0",
    normalize: (p) => ({
      owner: str(p.PartyName),
      parcel_id: str(p.PropertyNumber) ?? str(p.PIN),
      address: str(p.PropertyAddress),
      acres: numOrNull(p.Acres),
      // Multi-line "street \n suite \n city, st zip" -> single line.
      owner_mailing_address: str(String(p.PartyAddress ?? "").replace(/\s*\n\s*/g, ", ")),
    }),
  },
  {
    // DCAD's county-wide public layer (verified live 2026-07-09, works
    // outside Dallas city limits too). No PTAD state class and no building
    // sqft — feeds gate on the normalized fallbacks; Division ("Res"/"Com")
    // rides in land_use as the commercial discriminator.
    county: "Dallas",
    url: "https://services9.arcgis.com/Csff1W9rNs7Zx9MT/arcgis/rest/services/Parcel_View/FeatureServer/0",
    normalize: (p) => {
      // AREA_SIZE is a string qualified by AREA_UNIT ("SQFT" | "ACRE").
      const size = Number.parseFloat(String(p.AREA_SIZE ?? "")) || null;
      const isSqft = String(p.AREA_UNIT ?? "").toUpperCase().startsWith("SQ");
      return {
        owner: str(p.Owner_Name1),
        parcel_id: str(p.Account_Num) ?? str(p.GIS_Parcel_Id),
        address: str([str(p.Street_Num), str(p.Full_Street_Name)].filter(Boolean).join(" ")),
        acres: size == null ? null : isSqft ? size / 43560 : size,
        market_value: numOrNull(p.Tot_Val) || null,
        owner_mailing_address: str(
          [
            [str(p.Owner_Address_Line1), str(p.Owner_Address_Line2)].filter(Boolean).join(" "),
            str(p.Owner_City),
            [str(p.Owner_State), str(p.Owner_ZipCode)].filter(Boolean).join(" "),
          ]
            .filter(Boolean)
            .join(", ")
        ),
        improvement_value: numOrNull(p.Imp_Val) || null,
        land_sqft: size != null && isSqft ? size : null,
        state_class: null, // not published county-wide
        land_use: str(p.Division), // "Res" | "Com"
      };
    },
  },
  {
    // Tarrant County GIS Tax/TCProperty (verified live 2026-07-09). Strings
    // arrive fixed-width padded (str() trims). No PTAD class or land use.
    county: "Tarrant",
    url: "https://mapit.tarrantcounty.com/arcgis/rest/services/Tax/TCProperty/MapServer/0",
    normalize: (p) => ({
      owner: str(p.OWNER_NAME),
      parcel_id: str(p.ACCOUNT) ?? str(p.TAXPIN),
      address: str(p.SITUS_ADDR),
      acres: numOrNull(p.LAND_ACRES),
      market_value: numOrNull(p.TOTAL_VALU) || null,
      owner_mailing_address: str(
        [str(p.OWNER_ADDR), str(p.OWNER_CITY), str(p.OWNER_ZIP)].filter(Boolean).join(", ")
      ),
      building_sqft: numOrNull(p.LIVING_ARE) || null,
      improvement_value: numOrNull(p.IMPR_VALUE) || null,
      land_sqft: numOrNull(p.LAND_SQFT) || null,
      // TAD publishes no PTAD class/land-use, but BEDROOMS/LIVING_ARE are
      // residential-appraisal concepts (commercial rows carry 0 for both) —
      // derive the Res/Com flag the class gates read. Without this, EVERY
      // Tarrant venue failed the commercial gate and poisoned the reject
      // cache, and Tarrant houses passed the tax-sale fallback as commercial.
      land_use:
        (numOrNull(p.BEDROOMS) ?? 0) > 0 || (numOrNull(p.LIVING_ARE) ?? 0) > 0 ? "Res" : "Com",
    }),
  },
  {
    county: "Fort Bend",
    url: "https://gisweb.fbcad.org/arcgis/rest/services/Hosted/FBCAD_Public_Data/FeatureServer/0",
    normalize: (p) => ({
      owner: str(p.ownername),
      parcel_id: str(p.quickrefid) ?? str(p.propnumber),
      address: str(p.situs),
      acres: numOrNull(p.landsizeac),
      last_sale_date: dateOrNull(p.deeddate),
      market_value: numOrNull(p.totalvalue),
      owner_mailing_address: str(
        [
          [str(p.oaddr1), str(p.oaddr2), str(p.oaddr3)].filter(Boolean).join(" "),
          str(p.ownercity),
          [str(p.ownerstate), str(p.ownerzip)].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(", ")
      ),
    }),
  },
  {
    // BCAD parcels hosted by the San Antonio River Authority (verified live
    // 2026-07-10: 705,976 parcels, 2025 appraisal roll, real PTAD State_cd so
    // the commercial class gates work natively). Third-party host — if it
    // goes stale, point queries fail soft (null) like any other county.
    county: "Bexar",
    url: "https://gis.sara-tx.org/ags1/rest/services/FW_Bexar/BCAD_Parcels_PROD/FeatureServer/0",
    normalize: (p) => {
      const impr =
        (numOrNull(p.Imprv_hstd_val) ?? 0) + (numOrNull(p.Imprv_non_hstd_val) ?? 0);
      const acres = numOrNull(p.Land_acres);
      return {
        owner: str(p.Owner_name),
        parcel_id: str(p.Geo_id) ?? str(p.Prop_id),
        address: str(
          [str(p.Situs_num), str(p.Situs_street_prefix), str(p.Situs_street), str(p.Situs_street_sufix)]
            .filter(Boolean)
            .join(" ")
        ),
        acres,
        // Last_Deed_Date is a "MM/DD/YYYY" STRING on this layer.
        last_sale_date: dateOrNull(p.Last_Deed_Date),
        market_value: numOrNull(p.Market_val) || null,
        owner_mailing_address: str(
          [
            [str(p.Addr_line1), str(p.Addr_line2), str(p.Addr_line3)].filter(Boolean).join(" "),
            str(p.Addr_city),
            [str(p.Addr_state), str(p.Zip)].filter(Boolean).join(" "),
          ]
            .filter(Boolean)
            .join(", ")
        ),
        building_sqft: numOrNull(p.Sq_ft) || null,
        improvement_value: impr > 0 ? impr : null,
        land_sqft: acres && acres > 0 ? Math.round(acres * 43_560) : null,
        state_class: str(p.State_cd),
        land_use: null,
      };
    },
  },
  {
    // Bexar FALLBACK: the City of San Antonio's open-data copy of BCAD
    // parcels on ArcGIS Online infrastructure. The SARA host above answers
    // from dev machines but not from Vercel (first live SA feed run: every
    // point returned null in prod while resolving locally) — AGOL hosts are
    // proven reachable from prod (Dallas runs on one). Poorer fields (no
    // market value, no deed date) but carries the PTAD state_cd + acreage
    // the class gates need. The lookup races all services and takes the
    // first hit, so SARA's richer answer still wins wherever it's reachable.
    county: "Bexar",
    url: "https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/BCAD_Parcels/FeatureServer/0",
    normalize: (p) => {
      const legalAcres = numOrNull(p.legal_acre);
      const areaSqft = numOrNull(p.ParcelArea);
      const acres =
        legalAcres && legalAcres > 0
          ? legalAcres
          : areaSqft && areaSqft > 0
            ? areaSqft / 43_560
            : null;
      return {
        owner: str(p.Owner_Name),
        parcel_id: str(p.Geo_id) ?? str(p.PropID),
        address: str(p.Situs),
        acres,
        owner_mailing_address: str(
          [
            [str(p.addr_line1), str(p.addr_line2), str(p.addr_line3)].filter(Boolean).join(" "),
            str(p.addr_city),
            [str(p.addr_state), str(p.zip)].filter(Boolean).join(" "),
          ]
            .filter(Boolean)
            .join(", ")
        ),
        building_sqft: numOrNull(p.GBA_Living) || null, // string on this layer
        land_sqft: numOrNull(p.LandSqft) || (areaSqft ? Math.round(areaSqft) : null),
        state_class: str(p.state_cd),
        land_use: null,
      };
    },
  },
];

async function queryCountyWithAttrs(
  svc: CountyService,
  lng: number,
  lat: number,
  signal: AbortSignal
): Promise<{ parcel: ParcelResult; attrs: Record<string, unknown> } | null> {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
  });
  const res = await fetch(`${svc.url}/query?${params.toString()}`, { signal });
  if (!res.ok) return null;
  const data = (await res.json()) as { features?: ArcGisFeature[] };
  const f = data.features?.[0];
  if (!f?.geometry || (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon")) {
    return null;
  }
  const norm = svc.normalize(f.properties ?? {});
  return {
    parcel: {
      county: svc.county,
      ...norm,
      geometry: f.geometry as ParcelResult["geometry"],
    },
    attrs: f.properties ?? {},
  };
}

/**
 * All-counties lookup that also returns the raw layer attributes plus the
 * normalized parcel — the market-capable feeds (tax sales, TABC) gate on the
 * NORMALIZED state_class/acres so every county's field mapping applies.
 */
export async function fetchParcelAtPointWithAttrs(
  lng: number,
  lat: number
): Promise<{ parcel: ParcelResult; attrs: Record<string, unknown> } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const results = await Promise.allSettled(
      COUNTY_SERVICES.map((s) => queryCountyWithAttrs(s, lng, lat, controller.signal))
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) return r.value;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Harris-county-only lookup that also returns the raw layer attributes —
 * the openings pipeline needs `state_class` (F1 = real commercial) to reject
 * home-business addresses, and that field isn't part of ParcelResult.
 */
export async function fetchHarrisParcelAtPoint(
  lng: number,
  lat: number
): Promise<{ parcel: ParcelResult; attrs: Record<string, unknown> } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    return await queryCountyWithAttrs(COUNTY_SERVICES[0], lng, lat, controller.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the parcel containing a point. Queries the covered counties in
 * parallel and returns the first hit. Resilient: a slow/failing service is
 * ignored (overall ~7s timeout) and null is returned rather than throwing, so
 * callers never block the page on county GIS availability.
 */
export async function fetchParcelAtPoint(
  lng: number,
  lat: number
): Promise<ParcelResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const results = await Promise.allSettled(
      COUNTY_SERVICES.map((s) => queryCountyWithAttrs(s, lng, lat, controller.signal))
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) return r.value.parcel;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
