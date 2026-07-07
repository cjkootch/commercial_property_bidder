"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { outreachCampaign, outreachRecipient, suppression } from "@/lib/db/schema";
import { leadPriceCents, exclusivePriceCents } from "@/lib/integrations/stripe";
import { leadMaxBuyers } from "@/lib/leads/availability";
import { buildRecipients } from "@/lib/campaigns/build";
import { sendEmail } from "@/lib/integrations/resend";
import { getDefaultCompany } from "@/lib/db/queries";

// Operator campaign review workflow. Gates: properties -> recipients ->
// messaging -> ready -> sent. Nothing sends until executeCampaign, and only
// after the operator walked (or auto_advance walked) every gate.

export async function createCampaign(): Promise<void> {
  const label = `Campaign ${new Date().toISOString().slice(0, 10)}`;
  const [c] = await db
    .insert(outreachCampaign)
    .values({
      label,
      stage: "properties",
      price_cents: leadPriceCents(),
      exclusive_price_cents: exclusivePriceCents(),
    })
    .returning();
  redirect(`/campaigns/${c.id}`);
}

/** Gate 1 → 2: lock in the selected leads + parameters, discover recipients. */
export async function approveProperties(campaignId: string, formData: FormData): Promise<void> {
  const ids = formData.getAll("property_id").map(String).filter(Boolean);
  const priceUsd = Math.max(1, Math.round(Number(formData.get("price_usd")) || 79));
  const exclUsd = Math.max(1, Math.round(Number(formData.get("exclusive_usd")) || 199));
  const maxBuyers = Math.min(50, Math.max(1, Math.round(Number(formData.get("max_buyers")) || 20)));
  if (!ids.length) redirect(`/campaigns/${campaignId}?err=${encodeURIComponent("Pick at least one property.")}`);

  await db
    .update(outreachCampaign)
    .set({
      property_ids: ids,
      price_cents: priceUsd * 100,
      exclusive_price_cents: exclUsd * 100,
      stage: "recipients",
      updated_at: new Date(),
    })
    .where(eq(outreachCampaign.id, campaignId));

  // Discover recipients now (skip companies that already bought/claimed here).
  const existingBuyers = await db.select().from(outreachRecipient).where(eq(outreachRecipient.campaign_id, campaignId));
  await db.delete(outreachRecipient).where(eq(outreachRecipient.campaign_id, campaignId));
  void existingBuyers;

  const built = await buildRecipients({
    propertyIds: ids,
    priceUsd,
    cap: leadMaxBuyers(),
    maxBuyers,
  });
  if (built.length) {
    await db.insert(outreachRecipient).values(
      built.map((r) => ({
        campaign_id: campaignId,
        company_name: r.company_name,
        email: r.email,
        website: r.website,
        contact_form_url: r.contact_form_url,
        city: r.city,
        lat: r.lat,
        lng: r.lng,
        property_id: r.property_id,
        distance_mi: r.distance_mi,
        subject: r.subject,
        body: r.body,
        claim_token: r.claim_token,
      }))
    );
  }
  revalidatePath(`/campaigns/${campaignId}`);
  redirect(`/campaigns/${campaignId}`);
}

/** Toggle a recipient in/out of the send at gate 2. */
export async function toggleRecipient(campaignId: string, recipientId: string, included: boolean): Promise<void> {
  await db
    .update(outreachRecipient)
    .set({ included, updated_at: new Date() })
    .where(and(eq(outreachRecipient.id, recipientId), eq(outreachRecipient.campaign_id, campaignId)));
  revalidatePath(`/campaigns/${campaignId}`);
}

/** Gate 2 → 3. */
export async function approveRecipients(campaignId: string): Promise<void> {
  await db.update(outreachCampaign).set({ stage: "messaging", updated_at: new Date() }).where(eq(outreachCampaign.id, campaignId));
  redirect(`/campaigns/${campaignId}`);
}

/** Edit one recipient's copy at gate 3. */
export async function updateMessage(campaignId: string, recipientId: string, formData: FormData): Promise<void> {
  const subject = ((formData.get("subject") as string) || "").trim().slice(0, 200);
  const body = ((formData.get("body") as string) || "").trim().slice(0, 4000);
  await db
    .update(outreachRecipient)
    .set({ subject, body, updated_at: new Date() })
    .where(and(eq(outreachRecipient.id, recipientId), eq(outreachRecipient.campaign_id, campaignId)));
  revalidatePath(`/campaigns/${campaignId}`);
}

/** Gate 3 → ready. */
export async function approveMessaging(campaignId: string): Promise<void> {
  await db.update(outreachCampaign).set({ stage: "ready", updated_at: new Date() }).where(eq(outreachCampaign.id, campaignId));
  redirect(`/campaigns/${campaignId}`);
}

export async function backToStage(campaignId: string, stage: string): Promise<void> {
  await db.update(outreachCampaign).set({ stage, updated_at: new Date() }).where(eq(outreachCampaign.id, campaignId));
  redirect(`/campaigns/${campaignId}`);
}

/** Gate 4: SEND. Emails included recipients that have an address (respecting
 *  suppression); those without an email are marked "manual" (paste into their
 *  contact form). This is the only send in the campaign flow. */
export async function executeCampaign(campaignId: string): Promise<void> {
  const [c] = await db.select().from(outreachCampaign).where(eq(outreachCampaign.id, campaignId)).limit(1);
  if (!c || c.stage !== "ready") redirect(`/campaigns/${campaignId}`);
  const co = await getDefaultCompany();
  const physical = co?.physical_mailing_address ?? null;

  const recipients = await db
    .select()
    .from(outreachRecipient)
    .where(and(eq(outreachRecipient.campaign_id, campaignId), eq(outreachRecipient.included, true)));
  const suppressed = new Set(
    (await db.select({ email: suppression.email }).from(suppression)).map((r) => r.email.toLowerCase())
  );

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "") || "https://greenkeep.us";
  for (const r of recipients) {
    if (!r.email) {
      await db.update(outreachRecipient).set({ status: "manual", updated_at: new Date() }).where(eq(outreachRecipient.id, r.id));
      continue;
    }
    if (suppressed.has(r.email.toLowerCase())) {
      await db.update(outreachRecipient).set({ status: "skipped", updated_at: new Date() }).where(eq(outreachRecipient.id, r.id));
      continue;
    }
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html =
      `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;line-height:1.55;">` +
      (r.body ?? "")
        .split(/\n\n+/)
        .map((p) => `<p style="margin:0 0 14px;">${esc(p).replace(/(https?:\/\/[^\s]+)/g, (u) => `<a href="${u}" style="color:#2f7d4f;font-weight:600;">${u}</a>`).replace(/\n/g, "<br>")}</p>`)
        .join("") +
      (physical ? `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;"><p style="color:#9ca3af;font-size:11px;">${esc(physical)}</p>` : "") +
      `</div>`;
    const res = await sendEmail({
      to: r.email,
      subject: r.subject ?? "A grounds contract near you",
      html,
      tags: { kind: "campaign", campaign: campaignId.slice(0, 8) },
    });
    await db
      .update(outreachRecipient)
      .set({ status: res.ok ? "sent" : "failed", sent_at: res.ok ? new Date() : null, updated_at: new Date() })
      .where(eq(outreachRecipient.id, r.id));
  }

  await db
    .update(outreachCampaign)
    .set({ stage: "sent", sent_at: new Date(), updated_at: new Date() })
    .where(eq(outreachCampaign.id, campaignId));
  redirect(`/campaigns/${campaignId}`);
}

export async function cancelCampaign(campaignId: string): Promise<void> {
  await db.update(outreachCampaign).set({ stage: "canceled", updated_at: new Date() }).where(eq(outreachCampaign.id, campaignId));
  redirect("/campaigns");
}
