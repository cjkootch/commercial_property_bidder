"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, postcard, prospect, prospectView } from "@/lib/db/schema";
import { currentBuyerId } from "../actions";
import {
  geocodeProspect,
  priceProspect,
  scanProspect,
  type ProspectPrice,
} from "@/lib/prospects/scan";
import { getActiveConfig, getDefaultCompany, toEngineConfig } from "@/lib/db/queries";
import { makeProposalSlug } from "@/lib/proposals";
import { getMapboxToken } from "@/lib/integrations/geocoding";
import {
  estimateServiceableArea as estimateServiceableAreaImpl,
  type ServiceableEstimate,
} from "@/lib/integrations/imagery";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import type { Confidence, PricingConfig } from "@/lib/pricing/types";
import type { GeometrySavePayload } from "@/app/properties/actions";
import type { ParcelResult } from "@/lib/geo/types";

const MAX_BULK = 50;

function baseUrl(): string {
  const envBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (envBase && !/localhost|127\.0\.0\.1/.test(envBase)) return envBase;
  const host = headers().get("host");
  return host ? `https://${host}` : "https://greenkeep.us";
}

/** The operator's active pricing config as engine input (buyers have none). */
async function operatorConfig(): Promise<PricingConfig | null> {
  const co = await getDefaultCompany();
  if (!co) return null;
  const cfg = await getActiveConfig(co.id);
  return cfg ? toEngineConfig(cfg) : null;
}

function toConfidence(raw: unknown): Confidence {
  return (["High", "Med", "Low"] as const).includes(raw as Confidence) ? (raw as Confidence) : "Med";
}

/**
 * Add one or more prospect addresses. Single (`address`/`city`/`name`) or bulk
 * (`addresses` textarea, one per line, capped). Geocodes each cheaply and inserts
 * a row (status "added"); the expensive scan is deferred to first open.
 */
export async function addProspects(formData: FormData): Promise<void> {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");

  const rl = await rateLimit(`prospects:add:${clientIp()}`, 60, 3600);
  if (!rl.ok) redirect("/buyers/prospects?err=rate");

  const single = ((formData.get("address") as string) || "").trim();
  const city = ((formData.get("city") as string) || "").trim() || null;
  const name = ((formData.get("name") as string) || "").trim() || null;
  const bulk = ((formData.get("addresses") as string) || "").trim();

  let entries: { address: string; city: string | null; name: string }[] = [];
  if (bulk) {
    entries = bulk
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, MAX_BULK)
      .map((a) => ({ address: a, city: null, name: a }));
  } else if (single) {
    entries = [{ address: single, city, name: name || single }];
  }
  if (!entries.length) redirect("/buyers/prospects?err=empty");

  for (const e of entries) {
    const geo = await geocodeProspect(e.address, e.city).catch(() => null);
    await db.insert(prospect).values({
      buyer_id: buyerId!,
      name: e.name.slice(0, 200),
      address: e.address.slice(0, 300),
      city: e.city,
      zip: geo?.zip ?? null,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      proposal_slug: makeProposalSlug(e.name),
    });
  }

  revalidatePath("/buyers/prospects");
  redirect(`/buyers/prospects?added=${entries.length}`);
}

/**
 * Lazily scan a prospect on first open (parcel + veg + aerial + price), cached.
 * No-op once scanned. Safe to call during render (no revalidatePath). Geocodes
 * first if the address didn't resolve at add time.
 */
export async function ensureProspectScanned(prospectId: string): Promise<void> {
  const buyerId = await currentBuyerId();
  if (!buyerId) return;
  const [p] = await db
    .select()
    .from(prospect)
    .where(and(eq(prospect.id, prospectId), eq(prospect.buyer_id, buyerId)))
    .limit(1);
  if (!p || p.status !== "added") return;

  let lng = p.lng;
  let lat = p.lat;
  if (lng == null || lat == null) {
    const geo = await geocodeProspect(p.address, p.city).catch(() => null);
    if (geo) {
      lng = geo.lng;
      lat = geo.lat;
      await db
        .update(prospect)
        .set({ lng, lat, zip: p.zip ?? geo.zip ?? null, updated_at: new Date() })
        .where(eq(prospect.id, prospectId));
    }
  }
  if (lng == null || lat == null) return;

  const rl = await rateLimit(`prospects:scan:${buyerId}`, 120, 3600);
  if (!rl.ok) return;

  const config = await operatorConfig();
  const scan = await scanProspect({ lng, lat }, config, getMapboxToken());

  await db
    .update(prospect)
    .set({
      parcel_geojson: scan.parcel,
      aerial: scan.aerial,
      turf_sqft: scan.turf_sqft,
      bed_sqft: scan.bed_sqft,
      ...(scan.price ?? {}),
      status: "scanned",
      updated_at: new Date(),
    })
    .where(eq(prospect.id, prospectId));
}

/**
 * Persist buyer-drawn service areas + re-price. Writes ONLY the prospect row —
 * never `measurement`/`property`/`pricing_result` — so buyer geometry can never
 * enter the ML training export. Reuses the operator map's GeometrySavePayload.
 */
export async function saveProspectGeometry(
  prospectId: string,
  payload: GeometrySavePayload
): Promise<void> {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const [p] = await db
    .select()
    .from(prospect)
    .where(and(eq(prospect.id, prospectId), eq(prospect.buyer_id, buyerId!)))
    .limit(1);
  if (!p) return;

  const complexity = payload.complexity || 1.0;
  const confidence = toConfidence(payload.confidence);
  const config = await operatorConfig();
  const price: ProspectPrice | null = config
    ? priceProspect(
        { turf_sqft: payload.turf_sqft, bed_sqft: payload.bed_sqft, complexity, confidence },
        config
      )
    : null;

  await db
    .update(prospect)
    .set({
      service_areas: payload.service_areas,
      map_view: payload.map_view,
      turf_sqft: payload.turf_sqft,
      bed_sqft: payload.bed_sqft,
      complexity: complexity.toFixed(2),
      confidence,
      ...(price ?? {}),
      ...(payload.lat != null && payload.lng != null ? { lat: payload.lat, lng: payload.lng } : {}),
      // Getting geometry counts as scanned; never downgrade a mailed/viewed card.
      ...(p.status === "added" ? { status: "scanned" as const } : {}),
      updated_at: new Date(),
    })
    .where(eq(prospect.id, prospectId));

  revalidatePath(`/buyers/prospects/${prospectId}`);
}

/** Vegetation estimate for the map's "Estimate from imagery" button. */
export async function estimateProspectVeg(prospectId: string): Promise<ServiceableEstimate | null> {
  const buyerId = await currentBuyerId();
  if (!buyerId) return null;
  const [p] = await db
    .select()
    .from(prospect)
    .where(and(eq(prospect.id, prospectId), eq(prospect.buyer_id, buyerId)))
    .limit(1);
  if (!p?.parcel_geojson) return null;
  return estimateServiceableAreaImpl(p.parcel_geojson as ParcelResult, getMapboxToken());
}

/** Set (or clear, with null) the buyer's monthly price override, in dollars. */
export async function setProspectPrice(
  prospectId: string,
  monthlyDollars: number | null
): Promise<void> {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const cents =
    monthlyDollars == null || !Number.isFinite(monthlyDollars) || monthlyDollars <= 0
      ? null
      : Math.round(monthlyDollars * 100);
  await db
    .update(prospect)
    .set({ price_override_cents: cents, updated_at: new Date() })
    .where(and(eq(prospect.id, prospectId), eq(prospect.buyer_id, buyerId!)));
  revalidatePath(`/buyers/prospects/${prospectId}`);
}

/** Pay to print + mail a branded postcard to this prospect's property. */
export async function startProspectPostcardCheckout(prospectId: string): Promise<void> {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const back = (msg: string): never =>
    redirect(`/buyers/prospects/${prospectId}?perr=${encodeURIComponent(msg)}`);

  const [p] = await db
    .select()
    .from(prospect)
    .where(and(eq(prospect.id, prospectId), eq(prospect.buyer_id, buyerId!)))
    .limit(1);
  if (!p) back("Prospect not found.");
  const [me] = await db.select().from(buyer).where(eq(buyer.id, buyerId!)).limit(1);
  if (!me) redirect("/buyers/login");
  if (!me.address || !me.city || !me.zip)
    back("Add your office address in your profile first — it's the postcard's return address.");

  const rlIp = await rateLimit(`postcard:ip:${clientIp()}`, 20, 3600);
  if (!rlIp.ok) back("Too many attempts — try again in a bit.");
  const rlBuyer = await rateLimit(`postcard:buyer:${buyerId}`, 25, 86400);
  if (!rlBuyer.ok) back("Daily postcard limit reached — try again tomorrow.");

  const base = baseUrl();
  const { postcardPriceCents, createProspectPostcardCheckout } = await import(
    "@/lib/integrations/stripe"
  );
  const res = await createProspectPostcardCheckout({
    amountCents: postcardPriceCents(),
    prospectLabel: p!.name ?? p!.address,
    buyerEmail: me.email,
    buyerId: me.id,
    prospectId,
    successUrl: `${base}/buyers/prospects/${prospectId}?mailed=1`,
    cancelUrl: `${base}/buyers/prospects/${prospectId}?canceled=1`,
  });
  if (!res.ok) back(res.error);
  redirect((res as { ok: true; url: string }).url);
}

/** Delete a prospect. If a postcard was mailed, soft-archive instead (keeps the
 *  microsite + postcard record alive for the QR already in the mail). */
export async function deleteProspect(prospectId: string): Promise<void> {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const [p] = await db
    .select()
    .from(prospect)
    .where(and(eq(prospect.id, prospectId), eq(prospect.buyer_id, buyerId!)))
    .limit(1);
  if (!p) redirect("/buyers/prospects");

  const [pc] = await db.select().from(postcard).where(eq(postcard.prospect_id, prospectId)).limit(1);
  if (pc) {
    await db
      .update(prospect)
      .set({ status: "archived", updated_at: new Date() })
      .where(eq(prospect.id, prospectId));
  } else {
    await db.delete(prospect).where(eq(prospect.id, prospectId));
  }
  revalidatePath("/buyers/prospects");
  redirect("/buyers/prospects");
}

/** Public microsite view tracking (called from /quote/[slug]). Best-effort. */
export async function recordProspectView(slug: string, userAgent: string | null): Promise<void> {
  try {
    const [p] = await db.select().from(prospect).where(eq(prospect.proposal_slug, slug)).limit(1);
    if (!p) return;
    await db
      .update(prospect)
      .set({
        view_count: sql`${prospect.view_count} + 1`,
        last_viewed_at: new Date(),
        ...(p.status === "scanned" || p.status === "mailed" ? { status: "viewed" as const } : {}),
      })
      .where(eq(prospect.id, p.id));
    await db.insert(prospectView).values({ prospect_id: p.id, user_agent: userAgent?.slice(0, 300) ?? null });
  } catch {
    // Never break the public page on a tracking failure.
  }
}
