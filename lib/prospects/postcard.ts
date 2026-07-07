// Fulfillment for a paid self-serve prospect postcard: build the art (aerial +
// QR to the buyer's hosted quote), verify addresses, create via Lob, record it,
// and flip the prospect to "mailed". Shared by the Stripe webhook. Idempotent on
// stripe_session_id. Mirrors lib/leads/postcard.ts but targets a prospect (not a
// leadUnlock) and points at /quote/<slug>.

import QRCode from "qrcode";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { buyer, postcard, prospect } from "../db/schema";
import { getDefaultCompany } from "../db/queries";
import { buildProspectPostcardHtml } from "../leads/postcard-art";
import { createPostcard, parseAddress, verifyDeliverable, type LobAddress } from "../integrations/lob";
import type { DossierAerial } from "../leads/dossier";
import type { ParcelResult } from "../geo/types";
import type { FulfillResult } from "../leads/postcard";

function appUrl(): string {
  const envBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return envBase && !/localhost|127\.0\.0\.1/.test(envBase) ? envBase : "https://greenkeep.us";
}

/** Best-effort recipient LobAddress for the property the buyer chose to mail. */
function prospectTo(
  p: { address: string; city: string | null; zip: string | null },
  name: string
): LobAddress | null {
  if (p.city) return { name, line1: p.address, city: p.city, state: "TX", zip: p.zip ?? "" };
  const parsed = parseAddress(p.address, name);
  if (parsed) return { ...parsed, zip: parsed.zip || (p.zip ?? "") };
  return null;
}

export async function fulfillProspectPostcard(opts: {
  prospectId: string;
  buyerId: string;
  priceCents: number;
  stripeSessionId?: string | null;
}): Promise<FulfillResult> {
  // Idempotency: same Stripe session already mailed.
  if (opts.stripeSessionId) {
    const [done] = await db
      .select()
      .from(postcard)
      .where(eq(postcard.stripe_session_id, opts.stripeSessionId))
      .limit(1);
    if (done)
      return done.status === "created" && done.lob_id
        ? { ok: true, postcardId: done.lob_id, expectedDelivery: done.expected_delivery }
        : { ok: false, error: "Already attempted." };
  }

  const [row] = await db
    .select({ p: prospect, b: buyer })
    .from(prospect)
    .innerJoin(buyer, eq(prospect.buyer_id, buyer.id))
    .where(and(eq(prospect.id, opts.prospectId), eq(prospect.buyer_id, opts.buyerId)))
    .limit(1);
  if (!row) return { ok: false, error: "Prospect not found." };
  const { p, b } = row;

  const parcel = p.parcel_geojson as ParcelResult | null;
  const ownerName = (parcel?.owner ?? "").trim() || "Property Manager";
  const to = prospectTo(p, ownerName.slice(0, 40));
  if (!to) return { ok: false, error: "The property address couldn't be parsed for mailing." };

  if (!b.address || !b.city || !b.zip)
    return { ok: false, error: "Add your office address in your profile before mailing." };
  const fromRaw: LobAddress = { name: b.company_name, line1: b.address, city: b.city, state: "TX", zip: b.zip };

  const toVer = await verifyDeliverable(to);
  const fromVer = await verifyDeliverable(fromRaw);
  if (!toVer.deliverable) return { ok: false, error: toVer.note };
  if (!fromVer.deliverable) return { ok: false, error: "Your office address isn't mailable — check your profile." };
  const toFinal = toVer.cleansed ?? to;
  const from = fromVer.cleansed ?? fromRaw;
  if (!toFinal.zip) return { ok: false, error: "The property ZIP couldn't be resolved for mailing." };
  if (!from.zip) return { ok: false, error: "Your office ZIP couldn't be resolved — check your profile." };

  const co = await getDefaultCompany();
  const accent = co?.brand_color || "#2f7d4f";
  const base = appUrl();
  const proposalUrl = `${base}/quote/${p.proposal_slug}`;
  const qrDataUrl = await QRCode.toDataURL(proposalUrl, { width: 480, margin: 1 }).catch(() => "");
  // Aerial served as a real JPEG by URL (Lob caps inline HTML at 10k chars).
  const aerial = p.aerial as DossierAerial | null;
  const aerialImageUrl = aerial?.image ? `${base}/api/postcard-asset/${p.proposal_slug}` : null;

  const { front, back } = buildProspectPostcardHtml({
    prospect: {
      name: p.name,
      city: p.city,
      aerial,
      turf_sqft: p.turf_sqft,
      monthly: p.price_override_cents != null ? p.price_override_cents / 100 : p.monthly_price,
      estimate_lo: p.estimate_lo,
      estimate_hi: p.estimate_hi,
    },
    buyer: b,
    proposalUrl,
    qrDataUrl,
    aerialImageUrl,
    accent,
  });

  const res = await createPostcard({
    to: toFinal,
    from,
    frontHtml: front,
    backHtml: back,
    description: `Greenkeep prospect ${p.proposal_slug}`,
  });

  const toAddress = [toFinal.line1, toFinal.city, `${toFinal.state} ${toFinal.zip}`].filter(Boolean).join(", ");

  if (!res.ok) {
    if (opts.stripeSessionId) {
      await db
        .insert(postcard)
        .values({
          prospect_id: opts.prospectId,
          buyer_id: opts.buyerId,
          status: "failed",
          price_cents: opts.priceCents,
          stripe_session_id: opts.stripeSessionId,
          to_name: toFinal.name,
          to_address: toAddress,
        })
        .onConflictDoNothing({ target: postcard.stripe_session_id });
    }
    return { ok: false, error: res.error };
  }

  await db
    .insert(postcard)
    .values({
      prospect_id: opts.prospectId,
      buyer_id: opts.buyerId,
      lob_id: res.id,
      status: "created",
      price_cents: opts.priceCents,
      stripe_session_id: opts.stripeSessionId ?? null,
      to_name: toFinal.name,
      to_address: toAddress,
      expected_delivery: res.expectedDelivery,
    })
    .onConflictDoNothing({ target: postcard.stripe_session_id });

  // Advance to mailed (don't downgrade a prospect the owner already viewed).
  if (p.status !== "viewed") {
    await db
      .update(prospect)
      .set({ status: "mailed", updated_at: new Date() })
      .where(eq(prospect.id, opts.prospectId));
  }

  return { ok: true, postcardId: res.id, expectedDelivery: res.expectedDelivery };
}
