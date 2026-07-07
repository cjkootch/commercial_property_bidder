// Dossier snapshot for a permit lead, computed ONCE at unlock time (free claim
// or Stripe payment) and stored on the lead_unlock row — so viewing a bought
// lead never re-spends imagery/API quota, and the buyer keeps exactly what they
// purchased. Contacts are public-record / self-published ONLY (never Apollo).

import { desc, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { pricingResult, property, type Property } from "../db/schema";
import { getActiveConfig, toEngineConfig } from "../db/queries";
import { sizeLead } from "./sizing";
import { estimateServiceableArea, fetchParcelTile } from "../integrations/imagery";
import { findTabsByNumber, fetchTabsDetails } from "../integrations/tabs";
import { findContact } from "../integrations/contact";
import { haversineMiles } from "../sourcing/criteria";
import type { ParcelResult } from "../geo/types";

/** Aerial snapshot: parcel-fit satellite tile + vegetation mask + parcel
 *  outline (image-pixel coordinates), stored as data URLs so the sheet never
 *  re-spends imagery quota and the buyer keeps the exact measurement view. */
export type DossierAerial = {
  image: string; // data:image/jpeg — bbox-fit to the parcel
  mask: string | null; // data:image/png translucent veg mask (null when projected)
  width: number;
  height: number;
  /** SVG polygon `points` strings (one per parcel ring) in image coordinates. */
  outline: string[];
};

export type Dossier = {
  gk_ref: string;
  name: string;
  address: string | null;
  city: string | null;
  zip: string | null;
  county: string | null;
  project_cost: string | null;
  work_type: string | null;
  est_start: string | null;
  est_completion: string | null;
  engage_by: string | null;
  scope: string | null;
  acres: number;
  turf_sqft: number;
  projected: boolean;
  annual_lo: number;
  annual_hi: number;
  monthly: number;
  crew_hours_per_visit: number;
  visits_per_year: number;
  contacts: { role: string; value: string }[];
  route_intel: string;
  guidance: string;
  intro_letter: string;
  prepared_at: string;
  aerial: DossierAerial | null;
};

const note = (notes: string | null, re: RegExp) => notes?.match(re)?.[1]?.trim() ?? null;
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** Outer-ring coordinates of the parcel polygon(s). */
function parcelOuterRings(parcel: ParcelResult): [number, number][][] {
  const g = parcel.geometry as GeoJSON.Geometry;
  if (g.type === "Polygon") return [g.coordinates[0] as [number, number][]];
  if (g.type === "MultiPolygon") return g.coordinates.map((poly) => poly[0] as [number, number][]);
  return [];
}

export async function buildDossier(p: Property, brand: string): Promise<Dossier | null> {
  const parcel = p.parcel_geojson as ParcelResult | null;
  const token = process.env.MAPBOX_API ?? null;
  if (!parcel || !token) return null;
  const cfgRow = await getActiveConfig(p.company_id);
  if (!cfgRow) return null;

  // One imagery pass feeds both the sizing numbers and the aerial snapshot.
  const engineCfg = toEngineConfig(cfgRow);
  const est = await estimateServiceableArea(parcel, token).catch(() => null);
  const sizing = await sizeLead(parcel, token, engineCfg, est);

  let aerial: DossierAerial | null = null;
  const tile = await fetchParcelTile(parcel, token).catch(() => null);
  if (tile) {
    // Same linear bbox->pixel mapping the vegetation mask uses.
    const px = (lng: number) => ((lng - tile.minLng) / (tile.maxLng - tile.minLng)) * tile.width;
    const py = (lat: number) => ((tile.maxLat - lat) / (tile.maxLat - tile.minLat)) * tile.height;
    const outline = parcelOuterRings(parcel).map((ring) =>
      ring.map(([lng, lat]) => `${px(lng).toFixed(1)},${py(lat).toFixed(1)}`).join(" ")
    );
    aerial = {
      image: `data:image/jpeg;base64,${tile.jpeg.toString("base64")}`,
      mask: !sizing.projected && est ? est.mask_data_url : null,
      width: tile.width,
      height: tile.height,
      outline,
    };
  }

  const tabsNum = note(p.notes, /TABS (\S+):/);
  const proj = tabsNum ? await findTabsByNumber(tabsNum) : null;
  const det = proj ? await fetchTabsDetails(proj.project_id) : null;

  const owner = det?.owner ?? note(p.notes, /Owner: ([^.]+)\./);
  const contacts: { role: string; value: string }[] = [];
  if (owner) contacts.push({ role: "Owner", value: owner });
  if (parcel.owner_mailing_address) contacts.push({ role: "Owner mail (county)", value: parcel.owner_mailing_address });
  if (det?.tenant) contacts.push({ role: "Tenant", value: det.tenant });
  if (det?.architect) contacts.push({ role: "Architect", value: det.architect });
  const pub = await findContact(parcel);
  if (pub?.phone) contacts.push({ role: "Published phone", value: pub.phone });
  if (pub?.email) contacts.push({ role: "Published email", value: pub.email });
  if (pub?.website) contacts.push({ role: "Website", value: pub.website });

  // Route intelligence from our measured book of business.
  let route_intel = "First measured property in this pocket — route-anchor opportunity.";
  if (p.lat != null && p.lng != null) {
    const others = await db.select().from(property).where(isNotNull(property.lat));
    const ids = others.map((x) => x.id);
    const prs = ids.length
      ? await db.select().from(pricingResult).where(inArray(pricingResult.property_id, ids)).orderBy(desc(pricingResult.created_at))
      : [];
    const annualBy = new Map<string, number>();
    for (const pr of prs) if (!annualBy.has(pr.property_id)) annualBy.set(pr.property_id, pr.annual_price);
    const near = others.filter(
      (x) => x.id !== p.id && x.lng != null && annualBy.has(x.id) && haversineMiles([p.lng!, p.lat!], [x.lng!, x.lat!]) <= 3
    );
    if (near.length) {
      const total = near.reduce((s, x) => s + (annualBy.get(x.id) ?? 0), 0);
      route_intel = `${near.length} other measured commercial propert${near.length === 1 ? "y" : "ies"} within 3 miles (≈ ${usd(total)}/yr combined maintenance value) — strong route density.`;
    }
  }

  const est_completion = proj?.est_end ? proj.est_end.slice(0, 10) : null;
  const engage_by = proj?.est_end
    ? new Date(new Date(proj.est_end).getTime() - 90 * 86400_000).toISOString().slice(0, 10)
    : null;

  const isPublic = /\b(ISD|COUNTY|CITY OF|UNIVERSITY|STATE|DISTRICT|AUTHORITY|COLLEGE)\b/i.test(owner ?? "");
  const guidance = isPublic
    ? `${owner} is a public entity: grounds work is typically bid through their purchasing department. Register as a vendor on their procurement site now, send the intro letter to get on the bidder list, and ask the architect's office which GC holds site work.`
    : `Private owner: send the intro letter to the owner's mailing address and call any published number. The architect can route you to the GC or the property manager who will hold the maintenance contract.`;

  const facility = p.name.replace(/ \(TABS [^)]+\)$/, "");
  const intro_letter = `Subject: Grounds maintenance for ${facility} — local contractor

Dear ${owner ?? "Owner"},

We understand ${facility} at ${p.address ?? "the project site"} is scheduled to complete construction around ${est_completion ?? "the coming year"}. [YOUR COMPANY] is a licensed and insured commercial grounds contractor serving ${p.city ?? "the area"} and the surrounding communities, and we would welcome the opportunity to bid the property's year-round grounds maintenance.

We are already familiar with the site — approximately ${sizing.turf_sqft.toLocaleString()} sq ft of maintained turf — and can provide a detailed proposal, references, and a certificate of insurance at your convenience.

Could you direct us to the right person or process for grounds vendors on this project?

Respectfully,
[NAME]
[YOUR COMPANY] · [PHONE] · [EMAIL]`;

  return {
    gk_ref: `GK-${(tabsNum ?? "X").replace(/\D/g, "").slice(-5) || "0"}`,
    name: facility,
    address: p.address,
    city: p.city,
    zip: p.zip,
    county: parcel.county,
    project_cost: note(p.notes, /est\. cost (\$[\d,]+)/),
    work_type: note(p.notes, /TABS \S+: ([^,]+),/),
    est_start: note(p.notes, /Est\. start ([\d-]+)/),
    est_completion,
    engage_by,
    scope: det?.scope ?? note(p.notes, /Scope: (.+)$/),
    acres: sizing.acres,
    turf_sqft: sizing.turf_sqft,
    projected: sizing.projected,
    annual_lo: sizing.annual_lo,
    annual_hi: sizing.annual_hi,
    monthly: Math.round(sizing.monthly),
    crew_hours_per_visit: Math.round(sizing.crew_hours_per_visit * 10) / 10,
    visits_per_year: engineCfg.visits_per_year,
    contacts,
    route_intel,
    guidance,
    intro_letter,
    prepared_at: new Date().toISOString().slice(0, 10),
    aerial,
  };
}
