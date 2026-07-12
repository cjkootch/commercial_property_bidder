// County parcel boundaries + owner-of-record via free public ArcGIS services
// (build spec section 12 parcel seam). Covers the NW-Houston target area:
//   - Harris County (Tomball / Spring / Cypress) — HCAD
//   - Montgomery County (Magnolia / Conroe) — MCAD via City of Conroe
//
// This NEVER auto-fills property.owner_org; the resolved owner is only a
// suggestion for the operator to confirm (build spec section 9).

import type { ParcelResult } from "../geo/types";
import { marketForCoords } from "../markets";

type ArcGisFeature = {
  geometry?: { type: string; coordinates: unknown };
  properties?: Record<string, unknown>;
};

type CountyService = {
  county: string;
  /** Two-letter state; absent = "TX". A point only queries services in its
   *  own market's state, so a TX lookup never hits the FL cadastral and back. */
  state?: string;
  /** ArcGIS layer query endpoint (…/MapServer/<id>). */
  url: string;
  /** Optional second lookup (e.g. a city zoning layer) merged over the
   *  normalized fields — for counties whose CAD publishes no class signal. */
  enrich?: (
    lng: number,
    lat: number,
    signal: AbortSignal
  ) => Promise<Partial<ReturnType<CountyService["normalize"]>>>;
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
  {
    // Travis County taxmaps layer (verified live 2026-07-10: 373,683
    // parcels, real PTAD land_state_cd, market values, owner). deed_date
    // exists but is ~2 years stale plus year-2222 sentinels — informational
    // only, never a freshness signal. County-hosted (not AGOL): verify
    // reachability from Vercel after deploy, same lesson as Bexar/SARA.
    county: "Travis",
    url: "https://taxmaps.traviscountytx.gov/arcgis/rest/services/Parcels/FeatureServer/0",
    normalize: (p) => {
      const impr =
        (numOrNull(p.imprv_homesite_val) ?? 0) + (numOrNull(p.imprv_non_homesite_val) ?? 0);
      return {
        owner: str(p.py_owner_name),
        parcel_id: str(p.geo_id) ?? str(p.PROP_ID),
        address: str(p.situs_address),
        // 0 means "not stated" on this layer (a $199M downtown block carries
        // tcad_acres 0) — null it so acreage gates don't treat it as tiny.
        acres: numOrNull(p.tcad_acres) || numOrNull(p.legal_acre) || null,
        last_sale_date: dateOrNull(p.deed_date),
        market_value: numOrNull(p.market_value) || null,
        owner_mailing_address: str(p.py_address),
        improvement_value: impr > 0 ? impr : null,
        state_class: str(p.land_state_cd),
        land_use: str(p.land_type_desc),
      };
    },
  },
  {
    // Williamson County parcels via Georgetown's open-data service
    // (verified live 2026-07-10). No PTAD class or values — the gates fall
    // back to acreage + explicit-residential rejection, like Montgomery.
    county: "Williamson",
    url: "https://gis.georgetowntexas.gov/arcgis/rest/services/OpenData/OpenData_FeatureService/FeatureServer/2",
    normalize: (p) => ({
      owner: str(p.OWNER),
      parcel_id: str(p.WCADID) ?? str(p.WCADR),
      address: str(p.SITEADD),
      acres: numOrNull(p.ACRES) || null, // 0 = not stated on this layer

      owner_mailing_address: str(
        [str(p.MAILADD), str(p.MAILCITY), [str(p.MAILST), str(p.MAILZIP)].filter(Boolean).join(" ")]
          .filter(Boolean)
          .join(", ")
      ),
    }),
  },
  {
    // Hays County (Kyle / Buda / San Marcos — the Austin market's only LGBS
    // tax-sale county). HaysCAD's AGOL-hosted layer (verified live
    // 2026-07-10): owner, values, acreage, situs — no PTAD class, so gates
    // fall back to acreage + explicit-residential like Williamson. Same
    // vendor/schema as the El Paso entry below (bis consulting CAD services).
    county: "Hays",
    url: "https://services6.arcgis.com/j94FvPaik4etwHFk/arcgis/rest/services/HaysCADWebService1/FeatureServer/0",
    normalize: (p) => ({
      owner: str(p.file_as_name),
      parcel_id: str(p.geo_id) ?? str(p.prop_id_text) ?? str(p.prop_id),
      address: str(
        [str(p.situs_num), str(p.situs_street_prefx), str(p.situs_street), str(p.situs_street_sufix)]
          .filter(Boolean)
          .join(" ")
      ),
      acres: numOrNull(p.legal_acreage) || null,
      last_sale_date: dateOrNull(p.Deed_Date),
      market_value: numOrNull(p.market) || null,
      owner_mailing_address: str(
        [
          [str(p.addr_line1), str(p.addr_line2), str(p.addr_line3)].filter(Boolean).join(" "),
          str(p.addr_city),
          [str(p.addr_state), str(p.zip)].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(", ")
      ),
      improvement_value: numOrNull(p.imprv_val) || null,
    }),
  },
  {
    // Nueces County (Corpus Christi) — same bisconsulting CAD schema as
    // Hays/El Paso (probe kit 2026-07-10: 157,032 parcels on AGOL infra).
    // No PTAD class; the city zoning layer supplies the Res/Com flag
    // (verified live: CG-2/GC at a Staples St Chick-fil-A). Third-party
    // AGOL mirror — best-effort; failure leaves the gates conservative.
    county: "Nueces",
    url: "https://services6.arcgis.com/j94FvPaik4etwHFk/arcgis/rest/services/NuecesCADWebService/FeatureServer/0",
    enrich: async (lng, lat, signal) => {
      const sp = new URLSearchParams({
        geometry: `${lng},${lat}`,
        geometryType: "esriGeometryPoint",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "TAG,TAG2023",
        returnGeometry: "false",
        f: "json",
      });
      const res = await fetch(
        `https://services1.arcgis.com/BSnEnFfEn54YLVeq/arcgis/rest/services/Corpus_Christi_Zoning/FeatureServer/46/query?${sp.toString()}`,
        { signal }
      );
      if (!res.ok) return {};
      const data = (await res.json()) as {
        features?: { attributes?: { TAG?: string; TAG2023?: string } }[];
      };
      const a = data.features?.[0]?.attributes;
      const zone = String(a?.TAG2023 ?? a?.TAG ?? "").trim();
      // 2023 codes: GC/NC/RC = commercial, IN/IL/IH = industrial, ON = office,
      // CG/CN/B legacy commercial; RS/RM/R = residential, FR farm.
      if (/^(G?C|N?C|RC|I|B|O)/i.test(zone) && !/^R/i.test(zone)) return { land_use: "Com" };
      if (/^(R|F)/i.test(zone)) return { land_use: "Res" };
      return {};
    },
    normalize: (p) => ({
      owner: str(p.file_as_name),
      parcel_id: str(p.geo_id) ?? str(p.prop_id_text) ?? str(p.prop_id),
      address: str(
        [str(p.situs_num), str(p.situs_street_prefx), str(p.situs_street), str(p.situs_street_sufix)]
          .filter(Boolean)
          .join(" ")
      ),
      acres: numOrNull(p.legal_acreage) || null,
      last_sale_date: dateOrNull(p.Deed_Date),
      market_value: numOrNull(p.market) || null,
      owner_mailing_address: str(
        [
          [str(p.addr_line1), str(p.addr_line2), str(p.addr_line3)].filter(Boolean).join(" "),
          str(p.addr_city),
          [str(p.addr_state), str(p.zip)].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(", ")
      ),
      improvement_value: numOrNull(p.imprv_val) || null,
    }),
  },
  {
    // McLennan County (Waco) — fourth bisconsulting CAD sibling (probe kit
    // 2026-07-10: 116,146 parcels, AGOL infra). No PTAD class; the City of
    // Waco zoning layer supplies Res/Com inside city limits (verified live:
    // C-2 polygon resolves); county venues outside stay conservative.
    county: "McLennan",
    url: "https://services8.arcgis.com/5e4b1SY8bogTc3pH/arcgis/rest/services/McLennanCADWebService/FeatureServer/0",
    enrich: async (lng, lat, signal) => {
      const sp = new URLSearchParams({
        geometry: `${lng},${lat}`,
        geometryType: "esriGeometryPoint",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "ZONING",
        returnGeometry: "false",
        f: "json",
      });
      const res = await fetch(
        `https://gis.wacotx.gov/server/rest/services/PublicMap/PublicMap_Planning_and_Economical_Development/FeatureServer/1/query?${sp.toString()}`,
        { signal }
      );
      if (!res.ok) return {};
      const data = (await res.json()) as {
        features?: { attributes?: { ZONING?: string } }[];
      };
      const zone = String(data.features?.[0]?.attributes?.ZONING ?? "").trim();
      // Waco codes: C-* commercial, O-* office, M-* industrial, R-* residential.
      if (/^[COM]/i.test(zone)) return { land_use: "Com" };
      if (/^R/i.test(zone)) return { land_use: "Res" };
      return {};
    },
    normalize: (p) => ({
      owner: str(p.file_as_name),
      parcel_id: str(p.geo_id) ?? str(p.prop_id_text) ?? str(p.prop_id),
      address: str(
        [str(p.situs_num), str(p.situs_street_prefx), str(p.situs_street), str(p.situs_street_sufix)]
          .filter(Boolean)
          .join(" ")
      ),
      acres: numOrNull(p.legal_acreage) || null,
      last_sale_date: dateOrNull(p.Deed_Date),
      market_value: numOrNull(p.market) || null,
      owner_mailing_address: str(
        [
          [str(p.addr_line1), str(p.addr_line2), str(p.addr_line3)].filter(Boolean).join(" "),
          str(p.addr_city),
          [str(p.addr_state), str(p.zip)].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(", ")
      ),
      improvement_value: numOrNull(p.imprv_val) || null,
    }),
  },
  {
    // El Paso County — EPCAD publishes through the SAME vendor/schema as
    // HaysCAD (verified live 2026-07-10: 401,228 parcels on AGOL infra).
    // Deed_Date arrives as an MM/DD/YYYY string; no PTAD class, so gates
    // fall back to acreage + explicit-residential.
    county: "El Paso",
    url: "https://services2.arcgis.com/fKvlzLJczghwPYHS/arcgis/rest/services/ElPasoCADWebService/FeatureServer/0",
    // EPCAD has no class signal at all, which made the conservative
    // commercial gates reject every El Paso venue. The city's zoning layer
    // (verified live 2026-07-10: C4 at Cielo Vista Mall) supplies the
    // Res/Com flag: C/M/I zones read commercial, R/A residential, special
    // districts stay unknown (gates stay conservative).
    enrich: async (lng, lat, signal) => {
      const sp = new URLSearchParams({
        geometry: `${lng},${lat}`,
        geometryType: "esriGeometryPoint",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "ZONE_",
        returnGeometry: "false",
        f: "json",
      });
      const res = await fetch(
        `https://gis.elpasotexas.gov/dev/rest/services/Planning/Zoning/FeatureServer/0/query?${sp.toString()}`,
        { signal }
      );
      if (!res.ok) return {};
      const data = (await res.json()) as {
        features?: { attributes?: { ZONE_?: string } }[];
      };
      const zone = String(data.features?.[0]?.attributes?.ZONE_ ?? "");
      if (/^[CMI]/i.test(zone)) return { land_use: "Com" };
      if (/^[RA]/i.test(zone)) return { land_use: "Res" };
      return {};
    },
    normalize: (p) => ({
      owner: str(p.file_as_name),
      parcel_id: str(p.geo_id) ?? str(p.prop_id_text) ?? str(p.prop_id),
      address: str(
        [str(p.situs_num), str(p.situs_street_prefx), str(p.situs_street), str(p.situs_street_sufix)]
          .filter(Boolean)
          .join(" ")
      ),
      acres: numOrNull(p.legal_acreage) || null,
      last_sale_date: dateOrNull(p.Deed_Date),
      market_value: numOrNull(p.market) || null,
      owner_mailing_address: str(
        [
          [str(p.addr_line1), str(p.addr_line2), str(p.addr_line3)].filter(Boolean).join(" "),
          str(p.addr_city),
          [str(p.addr_state), str(p.zip)].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(", ")
      ),
      improvement_value: numOrNull(p.imprv_val) || null,
    }),
  },
  {
    // Cameron County (Brownsville–Harlingen) — CCAD's own AGOL view (verified
    // live 2026-07-10: 185,233 parcels, 2025 appraisal roll, real PTAD stateCd
    // — 8,915 F1 + 162 F2 — so the commercial class gates work natively).
    // Snapshot vintage 2025-05-14 (layer name/exportDt): fine for enrichment
    // (owner/class/value), but deedDt is NOT a freshness signal — and ~20 rows
    // carry garbage future deed years (2029–2088), hence the sentinel guard.
    county: "Cameron",
    url: "https://services2.arcgis.com/6oaLMZEZlktbQpyi/arcgis/rest/services/CCAD_Parcels_View/FeatureServer/0",
    normalize: (p) => {
      // Blank-string sentinels (' ') throughout — str() trims them to null.
      const owner = str(p.owner);
      const deed = dateOrNull(p.deedDt);
      const impr = (numOrNull(p.impHS) ?? 0) + (numOrNull(p.impNHS) ?? 0);
      return {
        // Placeholder rows awaiting CAD research carry a literal
        // "PENDING RESEARCH" owner — that's "unknown", not a name.
        owner: owner && /pending research/i.test(owner) ? null : owner,
        parcel_id: str(p.geoID) ?? str(p.GEO_ID) ?? str(p.pID),
        address: str(
          [str(p.situsNo), str(p.sitPfx), str(p.sitStr), str(p.sitSfx)]
            .filter(Boolean)
            .join(" ")
        ),
        acres: numOrNull(p.acres) || null, // 0 means "not stated"
        last_sale_date:
          deed && Number(deed.slice(0, 4)) > new Date().getFullYear() + 1 ? null : deed,
        market_value: numOrNull(p.market) || null,
        owner_mailing_address: str(
          [
            [str(p.addr1), str(p.addr2), str(p.addr3)].filter(Boolean).join(" "),
            str(p.addrCity),
            [str(p.addrState), str(p.addrZip)].filter(Boolean).join(" "),
          ]
            .filter(Boolean)
            .join(", ")
        ),
        building_sqft: numOrNull(p.lvgArea) || null,
        improvement_value: impr || null,
        state_class: str(p.stateCd),
      };
    },
  },
  {
    // Jefferson County (Beaumont–Port Arthur) — the PACS-export layer on the
    // Port of Beaumont's AGOL org (verified live 2026-07-10: 122,329 parcels,
    // CURRENT 2026 tax year, real PTAD state_code — 5,785 F1 — so the class
    // gates work natively). NOTE: layer id 1, not 0; the org also hosts a
    // stale 2018 partial extract under a similar name — don't confuse them.
    // Third-party mirror — best-effort, failure leaves the gates conservative.
    county: "Jefferson",
    url: "https://services.arcgis.com/ZXAF35aJr7XcgDMv/arcgis/rest/services/JCAD_Parcels/FeatureServer/1",
    normalize: (p) => ({
      owner: str(p.file_as_name),
      parcel_id: str(p.geo_id) ?? str(p.Prop_ID) ?? str(p.prop_id_1),
      // `situs` holds just the street NUMBER on this layer.
      address: str(
        [str(p.situs), str(p.situs_street_prefx), str(p.situs_street), str(p.situs_street_sufix)]
          .filter(Boolean)
          .join(" ")
      ),
      acres: numOrNull(p.legal_acreage) || null, // 0 means "not stated"
      last_sale_date: dateOrNull(p.coo_sl_dt), // change-of-ownership, epoch ms
      market_value: numOrNull(p.market) || null,
      owner_mailing_address: str(
        [
          [str(p.addr_line1), str(p.addr_line2), str(p.addr_line3)].filter(Boolean).join(" "),
          str(p.addr_city),
          [str(p.addr_state), str(p.zip)].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(", ")
      ),
      building_sqft: numOrNull(p.total_imprv_area) || null,
      improvement_value: numOrNull(p.imprv_val) || null,
      state_class: str(p.state_code), // arrives space-padded ('F1   ')
    }),
  },
  {
    // Orange County, FL (Orlando) — via the statewide FDOR Cadastral 2025 AGOL
    // layer (public Query,Extract). Re-probed live 2026-07-12: point query with
    // outSR=4326 + f=geojson returns the parcel polygon in lng/lat plus JV
    // (just value), LND_VAL, LND_SQFOOT, owner + mailing, DOR use code. The
    // layer's native SR is 3086 but queryCountyWithAttrs forces outSR=4326.
    county: "Orange",
    state: "FL",
    url: "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0",
    normalize: (p) => {
      const jv = numOrNull(p.JV); // FL "just value" = total market value.
      const lnd = numOrNull(p.LND_VAL);
      const sqft = numOrNull(p.LND_SQFOOT);
      const dorUc = str(p.DOR_UC);
      return {
        owner: str(p.OWN_NAME),
        parcel_id: str(p.PARCEL_ID),
        address:
          str([str(p.PHY_ADDR1), str(p.PHY_CITY)].filter(Boolean).join(", ")),
        acres: sqft ? sqft / 43560 : null,
        market_value: jv,
        owner_mailing_address: str(
          [
            [str(p.OWN_ADDR1), str(p.OWN_ADDR2)].filter(Boolean).join(" "),
            str(p.OWN_CITY),
            [str(p.OWN_STATE), str(p.OWN_ZIPCD)].filter(Boolean).join(" "),
          ]
            .filter(Boolean)
            .join(", ")
        ),
        // FDOR TOT_LVG_AREA is residential-only, so no commercial building sqft;
        // improvement value proxies building size (just value − land value).
        building_sqft: null,
        improvement_value: jv != null && lnd != null ? Math.max(0, jv - lnd) : null,
        land_sqft: sqft,
        // FL DOR use codes 041–049 are industrial/warehouse — map to the "F2"
        // marker the pricing models recognize so FL warehouses aren't quoted at
        // the office rate. Other FL codes (0xx/1xx) don't map to Texas PTAD
        // classes, so leave null (the models fall back to a wider band).
        state_class: dorUc && /^04[1-9]$/.test(dorUc) ? "F2" : null,
      };
    },
  },
];

/** The county services in a point's own state — a TX lookup never queries the
 *  FL cadastral (and vice versa), which keeps every lookup to its state's few
 *  services instead of racing all of them. */
function servicesFor(lng: number, lat: number): CountyService[] {
  const st = marketForCoords(lat, lng).state ?? "TX";
  return COUNTY_SERVICES.filter((s) => (s.state ?? "TX") === st);
}

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
  if (svc.enrich) {
    try {
      Object.assign(norm, await svc.enrich(lng, lat, signal));
    } catch {
      // enrichment is best-effort — the base parcel still stands
    }
  }
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
      servicesFor(lng, lat).map((s) => queryCountyWithAttrs(s, lng, lat, controller.signal))
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
      servicesFor(lng, lat).map((s) => queryCountyWithAttrs(s, lng, lat, controller.signal))
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
