// Fulfillment for a paid owner-postcard: build the art, verify the recipient,
// create it via Lob, record it, and stamp the outreach timeline. Shared so the
// Stripe webhook (paid) and any operator/manual path use one code path.
// Idempotent on stripe_session_id.

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { buyer, leadActivity, leadUnlock, postcard, property } from "../db/schema";
import { getDefaultCompany } from "../db/queries";
import type { Dossier } from "./dossier";
import { buildPostcardHtml } from "./postcard-art";
import { createPostcard, parseAddress, verifyDeliverable, type LobAddress } from "../integrations/lob";

export type FulfillResult =
  | { ok: true; postcardId: string; expectedDelivery: string | null }
  | { ok: false; error: string };

/** Pull the owner's mailing address out of the dossier contacts. */
function ownerMailing(d: Dossier): { name: string; line: string } | null {
  const owner = d.contacts.find((c) => c.role === "Owner")?.value ?? "the owner";
  const mail = d.contacts.find((c) => c.role.startsWith("Owner mail"))?.value;
  return mail ? { name: owner, line: mail } : null;
}

export async function fulfillPostcard(opts: {
  unlockId: string;
  buyerId: string;
  priceCents: number;
  stripeSessionId?: string | null;
}): Promise<FulfillResult> {
  // Idempotency: same Stripe session already mailed.
  if (opts.stripeSessionId) {
    const [done] = await db.select().from(postcard).where(eq(postcard.stripe_session_id, opts.stripeSessionId)).limit(1);
    if (done) return done.status === "created" && done.lob_id
      ? { ok: true, postcardId: done.lob_id, expectedDelivery: done.expected_delivery }
      : { ok: false, error: "Already attempted." };
  }

  const [row] = await db
    .select({ unlock: leadUnlock, prop: property, b: buyer })
    .from(leadUnlock)
    .innerJoin(property, eq(leadUnlock.property_id, property.id))
    .innerJoin(buyer, eq(leadUnlock.buyer_id, buyer.id))
    .where(and(eq(leadUnlock.id, opts.unlockId), eq(leadUnlock.buyer_id, opts.buyerId)))
    .limit(1);
  if (!row) return { ok: false, error: "Lead not found." };
  const d = row.unlock.dossier as Dossier | null;
  if (!d) return { ok: false, error: "This lead's sheet isn't ready yet." };

  const owner = ownerMailing(d);
  if (!owner) return { ok: false, error: "No mailing address on file for this owner." };
  const to = parseAddress(owner.line, owner.name);
  if (!to) return { ok: false, error: "The owner's address couldn't be parsed for mailing." };

  const b = row.b;
  // The return address uses the buyer's office address + the ZIP resolved from
  // Mapbox geocoding at profile-save time (never a placeholder). Lob's verify
  // step cleanses it further when live.
  const fromRaw: LobAddress | null =
    b.address && b.city && b.zip
      ? { name: b.company_name, line1: b.address, city: b.city, state: "TX", zip: b.zip }
      : null;
  if (!fromRaw)
    return {
      ok: false,
      error: b.address && b.city
        ? "We couldn't resolve your office ZIP — re-save your profile address before mailing."
        : "Add your office address in your profile before mailing.",
    };

  // Verify + cleanse both addresses so Lob accepts them.
  const fromVer = await verifyDeliverable(fromRaw);
  const toVer = await verifyDeliverable(to);
  if (!toVer.deliverable) return { ok: false, error: toVer.note };
  if (!fromVer.deliverable) return { ok: false, error: "Your office address isn't mailable — check your profile." };
  const from = fromVer.cleansed ?? fromRaw;
  const toFinal = toVer.cleansed ?? to;

  const co = await getDefaultCompany();
  const accent = co?.brand_color || "#2f7d4f";
  const { front, back } = buildPostcardHtml(d, b, accent);
  const res = await createPostcard({ to: toFinal, from, frontHtml: front, backHtml: back, description: `Greenkeep lead ${d.gk_ref}` });

  if (!res.ok) {
    if (opts.stripeSessionId) {
      await db
        .insert(postcard)
        .values({
          unlock_id: opts.unlockId,
          buyer_id: opts.buyerId,
          status: "failed",
          price_cents: opts.priceCents,
          stripe_session_id: opts.stripeSessionId,
          to_name: to.name,
          to_address: owner.line,
        })
        .onConflictDoNothing({ target: postcard.stripe_session_id });
    }
    return { ok: false, error: res.error };
  }

  await db
    .insert(postcard)
    .values({
      unlock_id: opts.unlockId,
      buyer_id: opts.buyerId,
      lob_id: res.id,
      status: "created",
      price_cents: opts.priceCents,
      stripe_session_id: opts.stripeSessionId ?? null,
      to_name: to.name,
      to_address: owner.line,
      expected_delivery: res.expectedDelivery,
    })
    .onConflictDoNothing({ target: postcard.stripe_session_id });

  await db.update(leadUnlock).set({ outreach_status: "postcard_sent", updated_at: new Date() }).where(eq(leadUnlock.id, opts.unlockId));
  await db.insert(leadActivity).values({
    unlock_id: opts.unlockId,
    kind: "postcard",
    detail: `Postcard mailed to ${to.name}${res.expectedDelivery ? ` — arrives ~${res.expectedDelivery}` : ""}`,
  });

  return { ok: true, postcardId: res.id, expectedDelivery: res.expectedDelivery };
}
