import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "../lib/db/schema";
import { DEFAULT_PRICING_CONFIG } from "../lib/pricing/config";
import { computePricing } from "../lib/pricing/engine";
import type { Confidence } from "../lib/pricing/types";

// Seed: one company, one active pricing_config (section 5.1 defaults), and the
// three section 5.3 properties with measurements + computed pricing_results, so
// the dashboard is non-empty on first run (build spec section 7).

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");

const db = drizzle(neon(url), { schema });

type SeedProperty = {
  name: string;
  address: string;
  city: string;
  icp_type: (typeof schema.icpTypeEnum.enumValues)[number];
  owner_org: string;
  turf_sqft: number;
  bed_sqft: number;
  complexity: number;
  confidence: Confidence;
};

const SEED_PROPERTIES: SeedProperty[] = [
  {
    name: "249 Self-Storage",
    address: "SH-249",
    city: "Tomball",
    icp_type: "self_storage",
    owner_org: "249 Storage Partners LLC",
    turf_sqft: 35000,
    bed_sqft: 1500,
    complexity: 1.0,
    confidence: "High",
  },
  {
    name: "Tomball Office Park",
    address: "FM-2920",
    city: "Tomball",
    icp_type: "office_park",
    owner_org: "Tomball Commercial Realty",
    turf_sqft: 18000,
    bed_sqft: 4000,
    complexity: 1.2,
    confidence: "High",
  },
  {
    name: "Magnolia Community Church",
    address: "FM-1488",
    city: "Magnolia",
    icp_type: "church",
    owner_org: "Magnolia Community Church",
    turf_sqft: 90000,
    bed_sqft: 2000,
    complexity: 1.0,
    confidence: "Med",
  },
];

async function main() {
  console.log("Seeding database…");

  // Idempotency guard: skip if a company already exists.
  const existing = await db.select().from(schema.company).limit(1);
  if (existing.length > 0) {
    console.log("A company already exists — skipping seed (run on an empty DB).");
    return;
  }

  const [co] = await db
    .insert(schema.company)
    .values({
      name: "NW Houston Commercial Grounds",
      address: "123 Commerce St",
      city: "Tomball",
      zip: "77375",
      phone: null,
      email: null,
      brand_color: "#2f6f4e",
      gl_insurance_amount: 2000000,
      coi_available: true,
      booking_url: "https://cal.com/nwhcg/walkthrough",
      physical_mailing_address: "123 Commerce St, Tomball, TX 77375",
      service_area_notes: "Tomball / Spring / Cypress / Magnolia corridor.",
    })
    .returning();

  const [cfg] = await db
    .insert(schema.pricingConfig)
    .values({
      company_id: co.id,
      ...DEFAULT_PRICING_CONFIG,
      is_active: true,
      version: 1,
    })
    .returning();

  for (const p of SEED_PROPERTIES) {
    const result = computePricing(
      {
        turf_sqft: p.turf_sqft,
        bed_sqft: p.bed_sqft,
        complexity: p.complexity,
        confidence: p.confidence,
      },
      DEFAULT_PRICING_CONFIG
    );

    const [prop] = await db
      .insert(schema.property)
      .values({
        company_id: co.id,
        name: p.name,
        address: p.address,
        city: p.city,
        icp_type: p.icp_type,
        owner_org: p.owner_org,
        source: "manual",
        status: "priced",
      })
      .returning();

    const [meas] = await db
      .insert(schema.measurement)
      .values({
        property_id: prop.id,
        turf_sqft: p.turf_sqft,
        bed_sqft: p.bed_sqft,
        complexity: p.complexity.toFixed(2),
        confidence: p.confidence,
        source: "manual",
      })
      .returning();

    await db.insert(schema.pricingResult).values({
      property_id: prop.id,
      measurement_id: meas.id,
      config_id: cfg.id,
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

    console.log(
      `  ${p.name}: $${result.price_per_visit.toFixed(2)}/visit, ` +
        `monthly $${result.monthly_price.toFixed(2)}, ` +
        `needs_review=${result.needs_review}` +
        (result.flags.reasons.length ? ` (${result.flags.reasons.join(" ")})` : "")
    );
  }

  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
