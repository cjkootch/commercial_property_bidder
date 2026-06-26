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
      acres: numOrNull(p.Acreage),
      last_sale_date: dateOrNull(p.new_owner_date),
      market_value: numOrNull(p.total_market_val),
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
    }),
  },
];

async function queryCounty(
  svc: CountyService,
  lng: number,
  lat: number,
  signal: AbortSignal
): Promise<ParcelResult | null> {
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
    county: svc.county,
    ...norm,
    geometry: f.geometry as ParcelResult["geometry"],
  };
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
      COUNTY_SERVICES.map((s) => queryCounty(s, lng, lat, controller.signal))
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
