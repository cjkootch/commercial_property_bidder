import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "./index";
import {
  buyer,
  company,
  leadUnlock,
  measurement,
  pricingConfig,
  pricingResult,
  property,
  proposal,
  prospect,
  outreach,
  contact,
  type PricingConfigRow,
} from "./schema";
import type { PricingConfig, PricingFlags } from "../pricing/types";
import type { MapView, ParcelResult, ServiceAreaCollection } from "../geo/types";
import {
  computeLeadScore,
  haversineMiles,
  isRecentOwnerChange,
  ROUTE_RADIUS_MILES,
} from "../sourcing/criteria";

/** Map a pricing_config DB row to the engine's PricingConfig shape. */
export function toEngineConfig(row: PricingConfigRow): PricingConfig {
  return {
    crew_size: row.crew_size,
    labor_cost_per_person_hour: row.labor_cost_per_person_hour,
    equipment_cost_per_crew_hour: row.equipment_cost_per_crew_hour,
    turf_min_per_acre: row.turf_min_per_acre,
    bed_min_per_1000sqft: row.bed_min_per_1000sqft,
    fixed_min_per_stop: row.fixed_min_per_stop,
    drive_min_per_stop: row.drive_min_per_stop,
    target_margin: row.target_margin,
    margin_floor: row.margin_floor,
    min_price_per_visit: row.min_price_per_visit,
    visits_per_year: row.visits_per_year,
    cole_profit_share: row.cole_profit_share,
    max_turf_acres: row.max_turf_acres,
    bed_turf_ratio_threshold: row.bed_turf_ratio_threshold,
    monthly_review_threshold: row.monthly_review_threshold,
    market_floor_per_acre_visit: row.market_floor_per_acre_visit,
    market_ceiling_per_acre_visit: row.market_ceiling_per_acre_visit,
  };
}

/** The single MVP company (first row). */
export async function getDefaultCompany() {
  const [row] = await db.select().from(company).limit(1);
  return row ?? null;
}

/** The active pricing config for a company. */
export async function getActiveConfig(companyId: string) {
  const [row] = await db
    .select()
    .from(pricingConfig)
    .where(and(eq(pricingConfig.company_id, companyId), eq(pricingConfig.is_active, true)))
    .orderBy(desc(pricingConfig.version))
    .limit(1);
  return row ?? null;
}

export type DashboardRow = {
  id: string;
  name: string;
  city: string | null;
  icp_type: string;
  status: string;
  owner_org: string | null;
  acknowledged_review: boolean;
  grass_fraction: number | null;
  annual_price: number | null;
  monthly_price: number | null;
  cole_annual_cut: number | null;
  needs_review: boolean;
  /** Composite 0–100 prospect score + the signals that drove it. */
  lead_score: number;
  lead_reasons: string[];
  /** Soft-archived (hidden from working lists; training data retained). */
  archived: boolean;
  /** Has a human-verified labelled measurement — it trained (or will train) the model. */
  modelled: boolean;
  /** Marketplace-ready: a permit lead with a parcel, not yet exported. */
  sellable: boolean;
  /** Buyer teaser band, when the lead has one. */
  teaser_lo: number | null;
  teaser_hi: number | null;
  /** Marketplace sales on this lead. */
  spots_sold: number;
  sold_exclusive: boolean;
};

/** All properties with their most recent pricing result, for the dashboard. */
export async function listDashboard(companyId: string): Promise<DashboardRow[]> {
  const props = await db
    .select()
    .from(property)
    .where(eq(property.company_id, companyId))
    .orderBy(desc(property.created_at));

  // Human-labelled measurements = properties that feed the model.
  const labelled = await db
    .select({ pid: measurement.property_id })
    .from(measurement)
    .where(and(isNotNull(measurement.service_areas), ne(measurement.source, "ml_pred")));
  const modelledIds = new Set(labelled.map((m) => m.pid));

  // Marketplace sales per property.
  const unlocks = await db
    .select({ pid: leadUnlock.property_id, kind: leadUnlock.kind })
    .from(leadUnlock);
  const soldBy = new Map<string, { count: number; exclusive: boolean }>();
  for (const u of unlocks) {
    const e = soldBy.get(u.pid) ?? { count: 0, exclusive: false };
    e.count++;
    if (u.kind === "exclusive") e.exclusive = true;
    soldBy.set(u.pid, e);
  }

  // Coordinates of every property, for route-density scoring.
  const coords = props
    .filter((p) => p.lng != null && p.lat != null)
    .map((p) => ({ id: p.id, pt: [p.lng as number, p.lat as number] as [number, number] }));
  const neighborsNearby = (p: (typeof props)[number]): number => {
    if (p.lng == null || p.lat == null) return 0;
    const here: [number, number] = [p.lng, p.lat];
    return coords.filter(
      (c) => c.id !== p.id && haversineMiles(here, c.pt) <= ROUTE_RADIUS_MILES
    ).length;
  };

  const rows: DashboardRow[] = [];
  for (const p of props) {
    const [pr] = await db
      .select()
      .from(pricingResult)
      .where(eq(pricingResult.property_id, p.id))
      .orderBy(desc(pricingResult.computed_at))
      .limit(1);

    const lastSale = (p.parcel_geojson as ParcelResult | null)?.last_sale_date ?? null;
    const { score, reasons } = computeLeadScore({
      grassFraction: p.grass_fraction,
      recentOwnerChange: isRecentOwnerChange(lastSale),
      activelyLeasing: p.actively_leasing,
      grossMarginPct: pr?.gross_margin_pct ?? null,
      neighborsNearby: neighborsNearby(p),
    });

    const teaser = p.lead_teaser as { annual_lo?: number; annual_hi?: number } | null;
    const sold = soldBy.get(p.id);
    rows.push({
      id: p.id,
      name: p.name,
      city: p.city,
      icp_type: p.icp_type,
      status: p.status,
      owner_org: p.owner_org,
      acknowledged_review: p.acknowledged_review,
      grass_fraction: p.grass_fraction ?? null,
      annual_price: pr?.annual_price ?? null,
      monthly_price: pr?.monthly_price ?? null,
      cole_annual_cut: pr?.cole_annual_cut ?? null,
      needs_review: pr?.needs_review ?? false,
      lead_score: score,
      lead_reasons: reasons,
      archived: p.archived_at != null,
      modelled: modelledIds.has(p.id),
      sellable: /\(TABS /.test(p.name) && p.parcel_geojson != null && p.lead_exported_at == null,
      teaser_lo: teaser?.annual_lo ?? null,
      teaser_hi: teaser?.annual_hi ?? null,
      spots_sold: sold?.count ?? 0,
      sold_exclusive: sold?.exclusive ?? false,
    });
  }
  return rows;
}

/** Everything the hosted proposal page needs, by slug. Null if not found. */
export async function getProposalBySlug(slug: string) {
  const [prop_] = await db.select().from(proposal).where(eq(proposal.slug, slug)).limit(1);
  if (!prop_) return null;
  const [prop] = await db.select().from(property).where(eq(property.id, prop_.property_id)).limit(1);
  const [pr] = await db
    .select()
    .from(pricingResult)
    .where(eq(pricingResult.id, prop_.pricing_result_id))
    .limit(1);
  const [co] = await db.select().from(company).where(eq(company.id, prop!.company_id)).limit(1);
  return { proposal: prop_, property: prop ?? null, pricing: pr ?? null, company: co ?? null };
}

/** Buyer self-serve microsite data, by slug: the prospect + its owning buyer
 *  (for branding). Null if not found. Renders even for archived prospects so a
 *  mailed postcard's QR keeps resolving. */
export async function getProspectBySlug(slug: string) {
  const [p] = await db.select().from(prospect).where(eq(prospect.proposal_slug, slug)).limit(1);
  if (!p) return null;
  const [b] = await db.select().from(buyer).where(eq(buyer.id, p.buyer_id)).limit(1);
  return { prospect: p, buyer: b ?? null };
}

export type CustomerProposal = {
  slug: string;
  property_name: string;
  status: string;
  monthly_price: number | null;
  annual_price: number | null;
  accepted_at: string | null;
  walkthrough_requested_at: string | null;
};

/**
 * Proposals visible to a customer: any property where they're a saved contact
 * (matched by email, case-insensitive) that has a proposal. Powers the
 * magic-link customer portal.
 */
export async function getCustomerProposals(email: string): Promise<CustomerProposal[]> {
  const e = email.toLowerCase().trim();
  const rows = await db
    .select({
      slug: proposal.slug,
      property_name: property.name,
      status: proposal.status,
      monthly_price: pricingResult.monthly_price,
      annual_price: pricingResult.annual_price,
      accepted_at: proposal.accepted_at,
      walkthrough_requested_at: proposal.walkthrough_requested_at,
    })
    .from(contact)
    .innerJoin(property, eq(contact.property_id, property.id))
    .innerJoin(proposal, eq(proposal.property_id, property.id))
    .leftJoin(pricingResult, eq(proposal.pricing_result_id, pricingResult.id))
    .where(sql`lower(${contact.email}) = ${e}`)
    .orderBy(desc(proposal.created_at));

  // De-dupe to the most recent proposal per property.
  const seen = new Set<string>();
  const out: CustomerProposal[] = [];
  for (const r of rows) {
    if (seen.has(r.property_name)) continue;
    seen.add(r.property_name);
    out.push({
      slug: r.slug,
      property_name: r.property_name,
      status: r.status,
      monthly_price: r.monthly_price ?? null,
      annual_price: r.annual_price ?? null,
      accepted_at: r.accepted_at?.toISOString() ?? null,
      walkthrough_requested_at: r.walkthrough_requested_at?.toISOString() ?? null,
    });
  }
  return out;
}

/** Is this email a contact on the property behind this proposal slug? (authz) */
export async function customerOwnsProposal(email: string, slug: string): Promise<boolean> {
  const e = email.toLowerCase().trim();
  const [row] = await db
    .select({ id: proposal.id })
    .from(proposal)
    .innerJoin(contact, eq(contact.property_id, proposal.property_id))
    .where(and(eq(proposal.slug, slug), sql`lower(${contact.email}) = ${e}`))
    .limit(1);
  return !!row;
}

/** Latest outreach (email) for a property, for send + open-rate display. */
export async function getPropertyOutreach(propertyId: string) {
  const [row] = await db
    .select()
    .from(outreach)
    .where(eq(outreach.property_id, propertyId))
    .orderBy(desc(outreach.created_at))
    .limit(1);
  return row ?? null;
}

/** The current proposal for a property (most recent), or null. */
export async function getPropertyProposal(propertyId: string) {
  const [row] = await db
    .select()
    .from(proposal)
    .where(eq(proposal.property_id, propertyId))
    .orderBy(desc(proposal.created_at))
    .limit(1);
  return row ?? null;
}

/** Full detail for one property: latest measurement + latest pricing result. */
export async function getPropertyDetail(propertyId: string) {
  const [prop] = await db.select().from(property).where(eq(property.id, propertyId)).limit(1);
  if (!prop) return null;

  const [meas] = await db
    .select()
    .from(measurement)
    .where(eq(measurement.property_id, propertyId))
    .orderBy(desc(measurement.measured_at))
    .limit(1);

  const [pr] = await db
    .select()
    .from(pricingResult)
    .where(eq(pricingResult.property_id, propertyId))
    .orderBy(desc(pricingResult.computed_at))
    .limit(1);

  return {
    property: prop,
    measurement: meas ?? null,
    pricing: pr ?? null,
    flags: (pr?.flags as PricingFlags | undefined) ?? null,
    serviceAreas: (meas?.service_areas as ServiceAreaCollection | null | undefined) ?? null,
    mapView: (meas?.map_view as MapView | null | undefined) ?? null,
  };
}
