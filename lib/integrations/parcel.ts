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
