"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contact, measurement, pricingResult, property } from "@/lib/db/schema";
import { getActiveConfig, getDefaultCompany, toEngineConfig } from "@/lib/db/queries";
import { geocodeAddress, getMapboxToken } from "@/lib/integrations/geocoding";
import { fetchParcelAtPoint } from "@/lib/integrations/parcel";
import { estimateServiceableArea } from "@/lib/integrations/imagery";
import { computePricing } from "@/lib/pricing/engine";
import { sendEmail } from "@/lib/integrations/resend";
import type { ParcelResult } from "@/lib/geo/types";

const ICP_VALUES = [
  "self_storage",
  "office_park",
  "medical",
  "church",
  "daycare",
  "retail_strip",
  "industrial",
  "residential",
  "other",
] as const;

function s(formData: FormData, key: string): string {
  return ((formData.get(key) as string) || "").trim();
}

export type InstantEstimateInput = {
  address: string;
  city?: string;
  zip?: string;
  type: "residential" | "commercial";
  startTiming?: string;
  email: string;
  name?: string;
  /** Optional pre-resolved [lng, lat] from the preview geocode, to skip re-geocoding. */
  coords?: [number, number];
};

export type InstantEstimateResult =
  | {
      ok: true;
      measured: true;
      // Default monthly range (weekly cadence) for headline display.
      low: number;
      high: number;
      // Per-visit range so the client can show per-frequency estimates.
      perVisitLow: number;
      perVisitHigh: number;
      bookingUrl: string | null;
    }
  | { ok: true; measured: false; bookingUrl: string | null }
  | { ok: false; error: string };

const roundTo = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);

/**
 * Fast geocode for the instant-quote "measuring" screen: resolve the address to
 * [lng, lat] up front so we can show the customer their actual property from
 * above while the heavier auto-measure runs. Returns null if it can't be placed.
 */
export async function geocodeForEstimate(input: {
  address: string;
  city?: string;
  zip?: string;
}): Promise<{ lng: number; lat: number } | null> {
  const address = input.address?.trim();
  if (!address) return null;
  const coords = await geocodeAddress([address, input.city, input.zip, "TX"].filter(Boolean).join(", "));
  return coords ? { lng: coords[0], lat: coords[1] } : null;
}

/**
 * Instant on-site estimate from an address: geocode → county parcel →
 * RGB turf auto-measure → pricing engine → a margin-safe RANGE (the exact price
 * is confirmed at the walkthrough). Always captures the lead (inbound property +
 * contact) and emails the estimate + booking link. Degrades to lead-capture
 * (no number) when the address is outside parcel coverage or can't be measured.
 */
export async function getInstantEstimate(
  input: InstantEstimateInput
): Promise<InstantEstimateResult> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) return { ok: false, error: "Enter a valid email." };
  const address = input.address.trim();
  if (!address) return { ok: false, error: "Enter your property address." };

  const co = await getDefaultCompany();
  if (!co) return { ok: false, error: "Something went wrong — please try again." };
  const bookingUrl = co.booking_url ?? null;

  const icp = input.type === "commercial" ? "office_park" : "residential";
  const startNote = input.startTiming ? ` Start: ${input.startTiming}.` : "";

  // Geocode + parcel + auto-measure (best-effort; any miss → lead-only fallback).
  // Reuse the preview geocode if the client already resolved it.
  const coords =
    input.coords ??
    (await geocodeAddress([address, input.city, input.zip, "TX"].filter(Boolean).join(", ")));
  const parcel = coords ? await fetchParcelAtPoint(coords[0], coords[1]) : null;
  const est = parcel ? await estimateServiceableArea(parcel as ParcelResult, getMapboxToken()) : null;

  // Always create the inbound lead.
  const [prop] = await db
    .insert(property)
    .values({
      company_id: co.id,
      name:
        input.type === "commercial"
          ? address
          : `${input.name?.trim() || "Homeowner"} — ${input.city || address}`,
      address,
      city: input.city || null,
      zip: input.zip || null,
      lat: coords?.[1] ?? null,
      lng: coords?.[0] ?? null,
      icp_type: icp,
      source: "inbound",
      status: "sourced",
      parcel_geojson: (parcel as ParcelResult) ?? null,
      grass_fraction: est?.vegetation_fraction ?? null,
      notes: `Instant ${input.type} quote request.${startNote}`,
    })
    .returning();

  await db.insert(contact).values({
    property_id: prop.id,
    full_name: input.name?.trim() || "Instant quote lead",
    email,
    source: "manual",
  });

  // No measurement possible → capture only, email a follow-up.
  if (!est || est.turf_sqft <= 0) {
    await sendEmail({
      to: email,
      subject: `Your ${co.name} quote request`,
      html:
        `<p>Thanks for reaching out about <strong>${address}</strong>.</p>` +
        `<p>We're preparing your estimate and will follow up shortly` +
        (bookingUrl ? ` — or grab a walkthrough time here: <a href="${bookingUrl}">${bookingUrl}</a>` : "") +
        `.</p><p>— ${co.name}</p>`,
    });
    return { ok: true, measured: false, bookingUrl };
  }

  // Price the auto-measured turf and persist a measurement + pricing snapshot.
  const cfgRow = await getActiveConfig(co.id);
  if (!cfgRow) return { ok: true, measured: false, bookingUrl };
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

  // Margin-safe range around the auto estimate (wider on the high side: the
  // model under-sees obstacles/complexity).
  const low = roundTo(result.monthly_price * 0.85, 5);
  const high = roundTo(result.monthly_price * 1.25, 5);
  const perVisitLow = roundTo(result.price_per_visit * 0.85, 5);
  const perVisitHigh = roundTo(result.price_per_visit * 1.25, 5);

  await sendEmail({
    to: email,
    subject: `Your ${co.name} estimate for ${address}`,
    html:
      `<p>Here's your instant estimate for <strong>${address}</strong>:</p>` +
      `<p style="font-size:20px"><strong>$${low.toLocaleString()}–$${high.toLocaleString()}/month</strong></p>` +
      `<p>This is an estimate from aerial measurements — we'll confirm the exact price at a quick walkthrough.</p>` +
      (bookingUrl ? `<p><a href="${bookingUrl}">Schedule your free walkthrough →</a></p>` : "") +
      `<p>— ${co.name}</p>`,
  });

  return { ok: true, measured: true, low, high, perVisitLow, perVisitHigh, bookingUrl };
}

/**
 * Public quote-intake. Creates an inbound `property` lead (+ a contact) that
 * drops straight into the operator pipeline as `sourced`. No auth. A hidden
 * honeypot field deters bots; submissions are operator-reviewed before any
 * outreach, so this never triggers sends.
 */
export async function submitQuoteRequest(formData: FormData): Promise<void> {
  const type = s(formData, "type") === "commercial" ? "commercial" : "residential";

  // Honeypot: real users never fill this hidden field. Pretend success.
  if (s(formData, "website_hp")) redirect(`/quote?type=${type}&sent=1`);

  const contactName = s(formData, "contact_name");
  const email = s(formData, "email");
  const phone = s(formData, "phone");
  const address = s(formData, "address");
  const city = s(formData, "city");
  const zip = s(formData, "zip");
  const orgName = s(formData, "org_name"); // commercial: business / property name
  const notes = s(formData, "notes");

  // Minimal validity: a way to reach them + a location.
  if ((!email && !phone) || !address) {
    redirect(`/quote?type=${type}&error=1`);
  }

  const co = await getDefaultCompany();
  if (!co) redirect(`/quote?type=${type}&error=1`);

  const icpRaw = s(formData, "icp_type");
  const icp =
    type === "residential"
      ? "residential"
      : (ICP_VALUES as readonly string[]).includes(icpRaw)
        ? (icpRaw as (typeof ICP_VALUES)[number])
        : "other";

  const propName =
    type === "commercial"
      ? orgName || address || "Inbound commercial lead"
      : `${contactName || "Homeowner"} — ${[city, zip].filter(Boolean).join(" ") || address}`;

  const [prop] = await db
    .insert(property)
    .values({
      company_id: co.id,
      name: propName,
      address: address || null,
      city: city || null,
      zip: zip || null,
      icp_type: icp,
      owner_org: type === "commercial" ? orgName || null : null,
      source: "inbound",
      status: "sourced",
      notes: [`Inbound ${type} quote request.`, notes].filter(Boolean).join(" "),
    })
    .returning();

  if (contactName || email || phone) {
    await db.insert(contact).values({
      property_id: prop.id,
      full_name: contactName || "Inbound lead",
      email: email || null,
      phone: phone || null,
      source: "manual",
    });
  }

  redirect(`/quote?type=${type}&sent=1`);
}
