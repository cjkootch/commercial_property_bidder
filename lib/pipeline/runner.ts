// Autonomous acquisition pipeline: advance properties down the funnel each run
// (nightly via Vercel cron, or `npm run pipeline`). Every step is bounded and
// best-effort, so a partial run is safe to re-run — the next run picks up
// wherever this one stopped.
//
//   source  -> grass-screen new commercial candidates, insert as 'sourced'
//   price   -> RGB-measure + price grass-qualified sourced properties
//   propose -> create the hosted proposal for priced properties
//   contact -> free contact finder (OSM tags + website scrape) — no Apollo
//              credits are ever spent automatically
//   queue   -> mark send-ready properties 'outreach_drafted' — the morning
//              APPROVAL QUEUE (/queue)
//
// GUARDRAIL: this runner NEVER sends email. Sends happen only from the queue
// via the operator's explicit approval (sendProposalEmail), per build spec §9.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  contact,
  measurement,
  pricingResult,
  property,
  proposal,
  suppression,
} from "../db/schema";
import { getActiveConfig, toEngineConfig } from "../db/queries";
import { computePricing } from "../pricing/engine";
import { searchCommercialPois } from "../integrations/osm";
import { fetchParcelAtPoint } from "../integrations/parcel";
import { estimateServiceableArea } from "../integrations/imagery";
import { findContact } from "../integrations/contact";
import { isGrassQualified, MIN_GRASS_FRACTION } from "../sourcing/criteria";
import {
  DEFAULT_SCOPE_ITEMS,
  frequencyOptionsFromPricing,
  makeProposalSlug,
} from "../proposals";
import { pruneUsageCounters } from "../ratelimit";
import type { ParcelResult } from "../geo/types";

// NW-Houston corridor: Tomball / Cypress / Spring / Magnolia. [S, W, N, E]
const BBOX: [number, number, number, number] = [29.95, -95.95, 30.3, -95.45];

export type PipelineCaps = {
  /** New qualified properties to source (0 disables sourcing). */
  sourceNew: number;
  /** Max candidate screens (parcel+imagery lookups) while sourcing. */
  sourceLookups: number;
  /** Max properties to measure+price this run. */
  price: number;
  /** Max free contact lookups this run. */
  contacts: number;
};

/** Conservative defaults sized for a 60s serverless budget; the pipeline
 *  compounds nightly, so small caps still add up (2/night = 60/month). */
export const CRON_CAPS: PipelineCaps = { sourceNew: 2, sourceLookups: 8, price: 3, contacts: 3 };

export type PipelineSummary = {
  sourced: string[];
  priced: string[];
  proposals: string[];
  contacts: string[];
  queued: string[];
  blocked_no_contact: number;
  errors: string[];
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function runPipeline(caps: PipelineCaps = CRON_CAPS): Promise<PipelineSummary> {
  const token = process.env.MAPBOX_API ?? null;
  const out: PipelineSummary = {
    sourced: [], priced: [], proposals: [], contacts: [], queued: [],
    blocked_no_contact: 0, errors: [],
  };

  const companyRow = await db.query.company.findFirst();
  if (!companyRow) {
    out.errors.push("no company row — run db:seed");
    return out;
  }

  // Housekeeping: drop rate-limit windows older than 2 days.
  await pruneUsageCounters();

  // ---- 1. SOURCE ----------------------------------------------------------
  if (caps.sourceNew > 0 && token) {
    try {
      const existing = await db.select({ name: property.name }).from(property);
      const have = new Set(existing.map((r) => r.name.trim().toLowerCase()));
      const pois = shuffle(await searchCommercialPois(BBOX)).filter(
        (p) => !have.has(p.name.trim().toLowerCase())
      );
      let lookups = 0;
      for (const p of pois) {
        if (out.sourced.length >= caps.sourceNew || lookups >= caps.sourceLookups) break;
        lookups++;
        try {
          const parcel = await fetchParcelAtPoint(p.lng, p.lat);
          if (!parcel) continue;
          const est = await estimateServiceableArea(parcel, token);
          if (!est || !isGrassQualified(est.vegetation_fraction, MIN_GRASS_FRACTION)) continue;
          await db.insert(property).values({
            company_id: companyRow.id,
            name: p.name,
            lat: p.lat,
            lng: p.lng,
            icp_type: p.icp_type,
            source: "places",
            status: "sourced",
            parcel_geojson: parcel,
            grass_fraction: est.vegetation_fraction,
            notes: "Sourced by pipeline runner.",
          });
          have.add(p.name.trim().toLowerCase());
          out.sourced.push(p.name);
        } catch (e) {
          out.errors.push(`source ${p.name}: ${e instanceof Error ? e.message : e}`);
        }
      }
    } catch (e) {
      out.errors.push(`source: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ---- 2. MEASURE + PRICE --------------------------------------------------
  // Pipeline-sourced, grass-qualified properties still at 'sourced'. The RGB
  // measurement is confidence Low by design — the human approval queue is the
  // accuracy gate (ML drafts upgraded via the seed-predictions loop instead).
  if (caps.price > 0 && token) {
    const cfgRow = await getActiveConfig(companyRow.id);
    if (!cfgRow) {
      out.errors.push("no active pricing config");
    } else {
      const candidates = await db
        .select()
        .from(property)
        .where(and(eq(property.status, "sourced"), eq(property.source, "places")))
        .orderBy(desc(property.created_at));
      let n = 0;
      for (const prop of candidates) {
        if (n >= caps.price) break;
        if (!prop.parcel_geojson) continue;
        if (!isGrassQualified(prop.grass_fraction != null ? Number(prop.grass_fraction) : null)) continue;
        try {
          const est = await estimateServiceableArea(prop.parcel_geojson as ParcelResult, token);
          if (!est || est.turf_sqft <= 0) continue;
          const turf = Math.round(est.turf_sqft);
          const [meas] = await db
            .insert(measurement)
            .values({
              property_id: prop.id,
              turf_sqft: turf,
              bed_sqft: 0,
              complexity: "1.00",
              confidence: "Low",
              source: "siterecon",
            })
            .returning();
          const result = computePricing(
            { turf_sqft: turf, bed_sqft: 0, complexity: 1.0, confidence: "Low" },
            toEngineConfig(cfgRow)
          );
          await db.insert(pricingResult).values({
            property_id: prop.id,
            measurement_id: meas.id,
            config_id: cfgRow.id,
            cost_per_visit: result.cost_per_visit,
            price_per_visit: result.price_per_visit,
            gross_profit_per_visit: result.gross_profit_per_visit,
            gross_margin_pct: result.gross_margin_pct,
            min_acceptable_price: result.min_acceptable_price,
            monthly_price: result.monthly_price,
            annual_price: result.annual_price,
            annual_gross_profit: result.annual_gross_profit,
            cole_annual_cut: result.cole_annual_cut,
            implied_per_acre_visit: result.implied_per_acre_visit,
            crew_hours_per_visit: result.crew_hours_per_visit,
            flags: result.flags,
            needs_review: result.needs_review,
          });
          await db.update(property).set({ status: "priced", updated_at: new Date() }).where(eq(property.id, prop.id));
          out.priced.push(prop.name);
          n++;
        } catch (e) {
          out.errors.push(`price ${prop.name}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
  }

  // ---- 3. PROPOSALS --------------------------------------------------------
  {
    const cfgRow = await getActiveConfig(companyRow.id);
    const visits = cfgRow?.visits_per_year ?? 42;
    const pricedProps = await db.select().from(property).where(eq(property.status, "priced"));
    for (const prop of pricedProps) {
      try {
        const [pr] = await db
          .select()
          .from(pricingResult)
          .where(eq(pricingResult.property_id, prop.id))
          .orderBy(desc(pricingResult.created_at))
          .limit(1);
        if (!pr) continue;
        const [existing] = await db
          .select()
          .from(proposal)
          .where(eq(proposal.property_id, prop.id))
          .orderBy(desc(proposal.created_at))
          .limit(1);
        if (!existing) {
          await db.insert(proposal).values({
            property_id: prop.id,
            pricing_result_id: pr.id,
            slug: makeProposalSlug(prop.name),
            frequency_options: frequencyOptionsFromPricing(pr, visits),
            scope_items: DEFAULT_SCOPE_ITEMS,
            status: "draft",
          });
        }
        await db.update(property).set({ status: "proposal_ready", updated_at: new Date() }).where(eq(property.id, prop.id));
        out.proposals.push(prop.name);
      } catch (e) {
        out.errors.push(`proposal ${prop.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  // ---- 4. CONTACTS (free finder only — never spends Apollo credits) --------
  if (caps.contacts > 0) {
    const readyProps = await db.select().from(property).where(eq(property.status, "proposal_ready"));
    const ids = readyProps.map((p) => p.id);
    const contacts = ids.length
      ? await db.select().from(contact).where(inArray(contact.property_id, ids))
      : [];
    const hasEmail = new Set(contacts.filter((c) => c.email?.trim()).map((c) => c.property_id));
    let n = 0;
    for (const prop of readyProps) {
      if (n >= caps.contacts) break;
      if (hasEmail.has(prop.id) || !prop.parcel_geojson) continue;
      try {
        const found = await findContact(prop.parcel_geojson as ParcelResult, [prop.name, prop.owner_org]);
        n++;
        if (!found?.email) continue;
        // OSM tags sometimes point at registries, not the occupant (e.g. a
        // state historical-commission address on a school). Skip government
        // domains outright; everything else surfaces in the queue with its
        // provenance visible for the operator to judge.
        if (/\.(gov|mil)$|\.gov\./i.test(found.email.split("@")[1] ?? "")) continue;
        await db.insert(contact).values({
          property_id: prop.id,
          full_name: found.name || "Property contact",
          email: found.email,
          phone: found.phone,
          source: "manual",
          title: found.sources.length ? `auto: ${found.sources.join(", ")}` : null,
        });
        hasEmail.add(prop.id);
        out.contacts.push(`${prop.name} <${found.email}>`);
      } catch (e) {
        out.errors.push(`contact ${prop.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  // ---- 5. QUEUE (send-ready -> 'outreach_drafted' == the approval queue) ----
  {
    const readyProps = await db.select().from(property).where(eq(property.status, "proposal_ready"));
    for (const prop of readyProps) {
      try {
        const [ct] = await db
          .select()
          .from(contact)
          .where(eq(contact.property_id, prop.id))
          .orderBy(desc(contact.created_at))
          .limit(1);
        const email = ct?.email?.trim();
        if (!email) {
          out.blocked_no_contact++;
          continue;
        }
        const [supp] = await db
          .select()
          .from(suppression)
          .where(sql`lower(${suppression.email}) = ${email.toLowerCase()}`)
          .limit(1);
        if (supp) continue;
        await db.update(property).set({ status: "outreach_drafted", updated_at: new Date() }).where(eq(property.id, prop.id));
        out.queued.push(prop.name);
      } catch (e) {
        out.errors.push(`queue ${prop.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  return out;
}
