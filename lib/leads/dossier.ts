// Dossier snapshot for a permit lead, computed ONCE at unlock time (free claim
// or Stripe payment) and stored on the lead_unlock row — so viewing a bought
// lead never re-spends imagery/API quota, and the buyer keeps exactly what they
// purchased. Contacts are public-record / self-published, PLUS a person-level
// decision contact via Apollo (deliberate policy change, Jul 2026): buyer-
// discovery data still never ships, but naming the human who awards the
// contract is part of what the sheet sells.

import { and, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import area from "@turf/area";
import { db } from "../db";
import { measurement, pricingResult, property, type Property } from "../db/schema";
import { getActiveConfig, toEngineConfig } from "../db/queries";
import { M2_TO_SQFT } from "../geo/area";
import { sizeLead, sizeLeadFromMeasurement } from "./sizing";
import { estimateServiceableArea, fetchParcelTile } from "../integrations/imagery";
import { findTabsByNumber, fetchTabsDetails } from "../integrations/tabs";
import { fetchDriveTime } from "../integrations/geocoding";
import { findContact } from "../integrations/contact";
import { findDecisionContact } from "../integrations/apollo";
import { ensurePropertyAttom, usdShort } from "../integrations/attom";
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
  /** Operator-drawn turf/bed polygons (image coordinates) when the lead was
   *  hand-measured — the buyer sees exactly what was measured. */
  measured?: { kind: string; points: string }[];
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
  /** Vegetation actually detected in today's imagery (null = none readable). */
  detected_sqft: number | null;
  annual_lo: number;
  annual_hi: number;
  monthly: number;
  crew_hours_per_visit: number;
  visits_per_year: number;
  contacts: { role: string; value: string }[];
  /** Assessor facts (ATTOM enrichment): value, building, last sale. Absent on
   *  sheets snapshotted before the integration or when ATTOM had no data. */
  facts?: { label: string; value: string }[];
  route_intel: string;
  guidance: string;
  intro_letter: string;
  prepared_at: string;
  aerial: DossierAerial | null;
  /** Driving time from the buyer's office (one-way), when their city is known. */
  drive: { minutes: number; miles: number } | null;
  /** Public-bid brief (RFP lead): no parcel/measurement — the deliverable is
   *  the solicitation. The sheet hides the measurement/pricing blocks. */
  is_bid?: boolean;
  /** Numbers come from an operator measurement (drawn polygons), not the
   *  automated estimate — the sheet badges this. */
  verified?: boolean;
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

export async function buildDossier(
  p: Property,
  brand: string,
  /** Buyer office [lng,lat] — adds drive time to the sheet. */
  buyerLoc?: [number, number] | null
): Promise<Dossier | null> {
  // Public-bid leads have no parcel — their dossier is a bid brief.
  if (/\(RFP [^)]+\)$/.test(p.name)) return buildBidBrief(p);
  const parcel = p.parcel_geojson as ParcelResult | null;
  const token = process.env.MAPBOX_API ?? null;
  if (!parcel || !token) return null;
  const cfgRow = await getActiveConfig(p.company_id);
  if (!cfgRow) return null;

  // One imagery pass feeds both the sizing numbers and the aerial snapshot.
  const engineCfg = toEngineConfig(cfgRow);
  const est = await estimateServiceableArea(parcel, token).catch(() => null);

  // An OPERATOR measurement (drawn polygons; never ml_pred) beats the
  // automated estimate: hand-verified numbers, tighter value band, and the
  // drawn areas render on the aerial so the buyer sees what was measured.
  const [opMeas] = await db
    .select()
    .from(measurement)
    .where(and(eq(measurement.property_id, p.id), ne(measurement.source, "ml_pred")))
    .orderBy(desc(measurement.measured_at))
    .limit(1);
  const parcelSqftD = area(parcel.geometry as GeoJSON.Geometry) * M2_TO_SQFT;
  const sizing = opMeas
    ? sizeLeadFromMeasurement(
        {
          turf_sqft: opMeas.turf_sqft,
          bed_sqft: opMeas.bed_sqft,
          complexity: Number(opMeas.complexity) || 1.0,
          confidence: opMeas.confidence,
        },
        parcelSqftD,
        engineCfg
      )
    : await sizeLead(parcel, token, engineCfg, est);

  let aerial: DossierAerial | null = null;
  const tile = await fetchParcelTile(parcel, token).catch(() => null);
  if (tile) {
    // Same linear bbox->pixel mapping the vegetation mask uses.
    const px = (lng: number) => ((lng - tile.minLng) / (tile.maxLng - tile.minLng)) * tile.width;
    const py = (lat: number) => ((tile.maxLat - lat) / (tile.maxLat - tile.minLat)) * tile.height;
    const outline = parcelOuterRings(parcel).map((ring) =>
      ring.map(([lng, lat]) => `${px(lng).toFixed(1)},${py(lat).toFixed(1)}`).join(" ")
    );
    // Operator-drawn turf/bed polygons in image coordinates (exclusion kinds
    // like building/pavement are skipped — the buyer cares what's mowable).
    const sa = opMeas?.service_areas as
      | { features?: { properties?: { kind?: string }; geometry?: { type?: string; coordinates?: number[][][] } }[] }
      | null;
    const measured = (sa?.features ?? [])
      .filter((f) => f.geometry?.type === "Polygon" && ["turf", "sports_turf", "bed"].includes(f.properties?.kind ?? ""))
      .map((f) => ({
        kind: f.properties!.kind!,
        points: (f.geometry!.coordinates![0] as unknown as [number, number][])
          .map(([lng, lat]) => `${px(lng).toFixed(1)},${py(lat).toFixed(1)}`)
          .join(" "),
      }));
    aerial = {
      image: `data:image/jpeg;base64,${tile.jpeg.toString("base64")}`,
      // With an operator measurement the drawn polygons are the story — the
      // raw detection mask would just muddy them. Otherwise always show what
      // we detected: on projected (low-veg) sites the mask plus the projected
      // number tells the honest story together.
      mask: opMeas && measured.length ? null : est?.mask_data_url ?? null,
      width: tile.width,
      height: tile.height,
      outline,
      measured: measured.length ? measured : undefined,
    };
  }

  // Lead kind from the sourcing ref embedded in the name: TABS = construction
  // filing, HCAD = ownership transfer, STP/TABC = new business opening (sales-
  // tax registration / alcohol license application — same vendor-decision
  // window), H311 = citation, TAX = county tax-sale pipeline. Everything
  // buyer-facing (letter, guidance, timeline) frames the SIGNAL, never the feed.
  const ref = p.name.match(/\((TABS|HCAD|STP|H311|TABC|TAX) ([^)]+)\)$/);
  const kind: "construction" | "transfer" | "opening" | "violation" | "distress" =
    ref?.[1] === "HCAD"
      ? "transfer"
      : ref?.[1] === "STP" || ref?.[1] === "TABC"
        ? "opening"
        : ref?.[1] === "H311"
          ? "violation"
          : ref?.[1] === "TAX"
            ? "distress"
            : "construction";

  const tabsNum = note(p.notes, /TABS (\S+):/);
  const proj = tabsNum ? await findTabsByNumber(tabsNum) : null;
  const det = proj ? await fetchTabsDetails(proj.project_id) : null;

  // ATTOM assessor facts: fetched at most once per property ever (metered
  // trial — see lib/integrations/attom.ts), then snapshotted into every sheet.
  // Fills owner/mailing gaps where county GIS is thin and adds the property
  // facts block (value, building, last sale) buyers price jobs with.
  const attom = await ensurePropertyAttom(p).catch(() => null);

  const owner = det?.owner ?? note(p.notes, /Owner: ([^.]+)\./) ?? attom?.owner ?? null;
  const facilityName = p.name.replace(/ \((TABS|HCAD|STP|H311|TABC|TAX) [^)]+\)$/, "");
  const contacts: { role: string; value: string }[] = [];
  if (owner) contacts.push({ role: "Owner", value: owner });
  if (parcel.owner_mailing_address) contacts.push({ role: "Owner mail (county)", value: parcel.owner_mailing_address });
  else if (attom?.owner_mailing) contacts.push({ role: "Owner mail (assessor)", value: attom.owner_mailing });
  if (det?.tenant) contacts.push({ role: "Tenant", value: det.tenant });
  if (det?.architect) contacts.push({ role: "Architect", value: det.architect });
  // Published contacts are vetted against the facility/owner names — a tenant
  // business on the parcel can only contribute a clearly-labeled phone.
  const pub = await findContact(parcel, [facilityName, owner, det?.tenant]);
  const unverified = pub?.sources.some((s) => s.includes("unverified"));
  if (pub?.phone)
    contacts.push({
      role: unverified ? `On-site phone (${pub.name ?? "unverified"})` : "Published phone",
      value: pub.phone,
    });
  if (pub?.email) contacts.push({ role: "Published email", value: pub.email });
  if (pub?.website) contacts.push({ role: "Website", value: pub.website });

  // Person-level decision contact (Apollo): the county names the LLC; this
  // names the human who awards the contract. Only shown when Apollo's org
  // match passes the name gate — a wrong person is worse than none.
  const person = await findDecisionContact(owner ?? det?.tenant ?? facilityName, {
    domain: pub?.website ?? null,
  }).catch(() => null);
  if (person) {
    contacts.push({
      role: "Decision contact",
      value: `${person.name}${person.title ? ` — ${person.title}` : ""} (${person.org})`,
    });
    if (person.email) contacts.push({ role: "Direct email", value: person.email });
    if (person.phone && person.phone !== pub?.phone)
      contacts.push({ role: "Direct phone", value: person.phone });
    if (!person.email && person.linkedin)
      contacts.push({ role: "LinkedIn", value: person.linkedin });
  }

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

  const opensDate = note(p.notes, /Opens ([\d-]+)/);
  const saleDate = note(p.notes, /HCAD transfer ([\d-]+)/) ?? parcel.last_sale_date ?? null;
  const est_completion =
    kind === "opening" ? opensDate : proj?.est_end ? proj.est_end.slice(0, 10) : null;
  // Construction: vendors are picked ~90 days before opening. Transfers and
  // openings: the decision window is already open — engage now.
  const engage_by =
    kind === "construction"
      ? proj?.est_end
        ? new Date(new Date(proj.est_end).getTime() - 90 * 86400_000).toISOString().slice(0, 10)
        : null
      : new Date().toISOString().slice(0, 10);

  const isPublic = /\b(ISD|COUNTY|CITY OF|UNIVERSITY|STATE|DISTRICT|AUTHORITY|COLLEGE)\b/i.test(owner ?? "");
  const guidance = isPublic
    ? `${owner} is a public entity: grounds work is typically bid through their purchasing department. Register as a vendor on their procurement site now, send the intro letter to get on the bidder list, and ask the architect's office which GC holds site work.`
    : kind === "transfer"
      ? `The property changed hands${saleDate ? ` on ${saleDate}` : " recently"} — new owners re-bid their vendors in the first year, so the incumbent (if any) is beatable right now. Send the intro letter to the owner's mailing address and call any published number; ask who handles property maintenance decisions.`
      : kind === "opening"
        ? `A new business is opening here — the property's vendor decisions are being made now. The grounds contract usually belongs to the property owner (landlord), not the tenant: send the intro letter to the owner's mailing address, and use any published on-site number to ask who manages the property.`
        : kind === "violation"
          ? `The city cited this property for weeds/overgrowth — the owner is REQUIRED to arrange service, usually within days, and a citation means there's likely no vendor on the property at all. Move fast: call any published number first, send the letter same-day, and lead with "we can have the citation cleared this week." Quote the recurring contract after the cleanup.`
          : kind === "distress"
            ? `This property is in the county's delinquent-tax process — a forced-action window on both sides of the sale. Before the auction, the owner (or their attorney) needs the property presentable and code-clean while they redeem or contest; after it, the winning investor re-bids every vendor from scratch. Send the letter to the owner's mailing address now, and put the address on your follow-up list for 30 days after the sale date — the new owner is the warmer buyer.`
            : `Private owner: send the intro letter to the owner's mailing address and call any published number. The architect can route you to the GC or the property manager who will hold the maintenance contract.`;

  // Assessor facts block (ATTOM): what the property is worth, how big the
  // building is, and when it last traded — the context a bidder prices with.
  const facts: { label: string; value: string }[] = [];
  if (attom) {
    const value = attom.market_value ?? attom.assessed_value;
    if (value) {
      facts.push({
        label: attom.market_value ? "Market value (assessor)" : "Assessed value",
        value: usdShort(value)!,
      });
    }
    if (attom.building_sqft) {
      facts.push({
        label: "Building",
        value: `${Math.round(attom.building_sqft).toLocaleString()} sf${attom.year_built ? ` · built ${attom.year_built}` : ""}`,
      });
    }
    if (attom.last_sale_date || attom.last_sale_price) {
      facts.push({
        label: "Last sale",
        value: [usdShort(attom.last_sale_price), attom.last_sale_date].filter(Boolean).join(" · "),
      });
    }
    if (attom.property_type) facts.push({ label: "Property type", value: attom.property_type });
  }

  const facility = facilityName;
  const situation =
    kind === "transfer"
      ? `recently changed ownership${saleDate ? ` (${saleDate})` : ""}, and property vendor arrangements are commonly reviewed after a sale`
      : kind === "opening"
        ? `has a new business opening${opensDate ? ` around ${opensDate}` : " soon"}, and property services are being arranged now`
        : kind === "violation"
          ? `may need immediate grounds attention, and we understand time can be of the essence in these situations`
          : kind === "distress"
            ? `may be going through a transition, and properties in transition often need the grounds brought back quickly and kept presentable`
            : `is scheduled to complete construction around ${est_completion ?? "the coming year"}`;
  const intro_letter = `Subject: Grounds maintenance for ${facility} — local contractor

Dear ${owner ?? "Owner"},

We understand ${facility} at ${p.address ?? "the project site"} ${situation}. [YOUR COMPANY] is a licensed and insured commercial grounds contractor serving ${p.city ?? "the area"} and the surrounding communities, and we would welcome the opportunity to bid the property's year-round grounds maintenance.

We are already familiar with the site — approximately ${sizing.turf_sqft.toLocaleString()} sq ft of maintained turf — and can provide a detailed proposal, references, and a certificate of insurance at your convenience.

Could you direct us to the right person or process for grounds vendors${kind === "construction" ? " on this project" : " at this property"}?

Respectfully,
[NAME]
[YOUR COMPANY] · [PHONE] · [EMAIL]`;

  return {
    gk_ref: `GK-${(tabsNum ?? ref?.[2] ?? "X").replace(/\D/g, "").slice(-5) || "0"}`,
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
    detected_sqft: est ? Math.round(est.turf_sqft) : null,
    facts: facts.length ? facts : undefined,
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
    verified: sizing.verified ?? false,
    drive:
      buyerLoc && p.lng != null && p.lat != null
        ? await fetchDriveTime(buyerLoc, [p.lng, p.lat]).catch(() => null)
        : null,
  };
}

/** The dossier for a public-bid (RFP) lead: a bid brief. No parcel, no
 *  imagery, no sizing — the contract's scope, site list, and dollars live in
 *  the solicitation documents; our value is surfacing it in time to bid. */
function buildBidBrief(p: Property): Dossier {
  const ref = p.name.match(/\(RFP ([^)]+)\)$/);
  const title = p.name.replace(/ \(RFP [^)]+\)$/, "");
  const bidRef = note(p.notes, /Public bid ([^:]+):/);
  const closes = note(p.notes, /Bids close (\d{4}-\d{2}-\d{2})/);
  const url = note(p.notes, /Solicitation: (\S+?)\.?$/m) ?? note(p.notes, /Solicitation: (\S+)\. Owner:/);
  const agency = note(p.notes, /Owner: ([^.]+)\./) ?? p.address ?? "the agency";

  const contacts: { role: string; value: string }[] = [{ role: "Agency", value: agency }];
  if (url) contacts.push({ role: "Solicitation", value: url });
  if (bidRef) contacts.push({ role: "Bid reference", value: bidRef });

  const guidance =
    `This is a public solicitation — the full scope, site list, bid forms, and any pre-bid ` +
    `meeting date are in the solicitation documents (link under Decision contacts). Register as a ` +
    `vendor on the agency's portal today, download the documents, and check two things before ` +
    `committing: the mandatory pre-bid meeting (missing it disqualifies you) and the bonding/` +
    `insurance requirements. Public grounds contracts typically run 1-3 years with renewal ` +
    `options — one win here anchors a route for years.` +
    (closes ? ` Bids close ${closes}: submit at least a day early.` : "");

  const intro_letter = `Subject: Vendor registration — grounds maintenance, ${bidRef ?? title}

To the Purchasing Department, ${agency}:

[YOUR COMPANY] is a licensed and insured commercial grounds contractor serving ${p.city ?? "the area"} and the surrounding communities. We intend to bid ${bidRef ?? "the referenced solicitation"} (${title}) and would appreciate being added to the bidder list for this and future grounds-maintenance solicitations.

Please confirm receipt and advise if a pre-bid meeting is scheduled.

Respectfully,
[NAME]
[YOUR COMPANY] · [PHONE] · [EMAIL]`;

  return {
    gk_ref: `GK-${(ref?.[1] ?? "X").replace(/\D/g, "").slice(-5) || "0"}`,
    name: title,
    address: p.address,
    city: p.city,
    zip: p.zip,
    county: null,
    project_cost: null,
    work_type: "Public grounds/landscaping contract",
    est_start: null,
    est_completion: null,
    engage_by: closes,
    scope: `Full scope, site list, and contract terms are in the solicitation documents.`,
    acres: 0,
    turf_sqft: 0,
    projected: false,
    detected_sqft: null,
    annual_lo: 0,
    annual_hi: 0,
    monthly: 0,
    crew_hours_per_visit: 0,
    visits_per_year: 0,
    contacts,
    route_intel: "Multi-site public contract — the site list is in the solicitation documents.",
    guidance,
    intro_letter,
    prepared_at: new Date().toISOString().slice(0, 10),
    aerial: null,
    drive: null,
    is_bid: true,
  };
}
