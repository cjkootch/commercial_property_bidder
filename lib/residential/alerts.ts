// Publish alerts: when the operator publishes a residential package, tell the
// opted-in buyers who can actually serve that area. Same rules as the
// commercial new-job alert (lib/pipeline/permits notifyBuyersOfFresh):
// notify=true only, suppression-checked, radius-gated when we know the
// buyer's office, one-click unsubscribe. One email per buyer per package,
// ever — the dedupe marker survives webhook retries and re-publishes.

import { eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { haversineMiles } from "../sourcing/criteria";
import { sendEmail } from "../integrations/resend";
import { signBuyerUnsub } from "../buyer-auth";
import type { PackageTeaser } from "./teaser";

// Far-future sentinel window so the counter pruner (which drops PAST windows)
// never erases these one-shot markers. Same pattern as the Stripe credit marker.
const MARKER_WINDOW = new Date("2099-01-01T00:00:00Z");
const MAX_SENDS = 200;

function base(): string {
  const b = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return b && !/localhost|127\.0\.0\.1/.test(b) ? b : "https://greenkeep.us";
}

export type PackageAlertSummary = { matched: number; sent: number };

export async function notifyBuyersOfPackagePublish(packageId: string): Promise<PackageAlertSummary> {
  const [pkg] = await db
    .select()
    .from(schema.residentialPackage)
    .where(eq(schema.residentialPackage.id, packageId))
    .limit(1);
  if (!pkg || pkg.status !== "published") return { matched: 0, sent: 0 };

  // Package centroid from its member addresses (for the radius gate).
  const members = await db
    .select({ lat: schema.residentialLead.lat, lng: schema.residentialLead.lng })
    .from(schema.residentialPackageMembership)
    .innerJoin(
      schema.residentialLead,
      eq(schema.residentialPackageMembership.residential_lead_id, schema.residentialLead.id)
    )
    .where(eq(schema.residentialPackageMembership.package_id, packageId));
  const placed = members.filter((m) => m.lat != null && m.lng != null);
  const centroid: [number, number] | null = placed.length
    ? [
        placed.reduce((a, m) => a + m.lng!, 0) / placed.length,
        placed.reduce((a, m) => a + m.lat!, 0) / placed.length,
      ]
    : null;

  const buyers = await db.select().from(schema.buyer).where(eq(schema.buyer.notify, true));
  if (!buyers.length) return { matched: 0, sent: 0 };
  const suppressed = new Set(
    (await db.select({ email: schema.suppression.email }).from(schema.suppression)).map((r) =>
      r.email.toLowerCase()
    )
  );
  const owners = new Set(
    (
      await db
        .select({ buyer_id: schema.residentialUnlock.buyer_id })
        .from(schema.residentialUnlock)
        .where(eq(schema.residentialUnlock.residential_package_id, packageId))
    ).map((r) => r.buyer_id)
  );

  const teaser = pkg.signal_summary as PackageTeaser | null;
  const price = `$${Math.round(pkg.price_cents / 100).toLocaleString()}`;
  const b0 = base();

  let matched = 0;
  let sent = 0;
  for (const b of buyers) {
    if (sent >= MAX_SENDS) break;
    if (suppressed.has(b.email.toLowerCase()) || owners.has(b.id)) continue;
    // Radius gate (+ the same cushion as commercial alerts). Buyers we can't
    // place still get the alert — we can't filter what we can't locate.
    if (b.lat != null && b.lng != null && centroid) {
      const reach = b.service_radius_mi + Math.max(15, Math.round(b.service_radius_mi * 0.4));
      if (haversineMiles([b.lng, b.lat], centroid) > reach) continue;
    }
    matched++;

    // One alert per buyer per package, ever (idempotent across retries).
    const marker = await db
      .insert(schema.usageCounter)
      .values({ key: `res_alert:${packageId}:${b.id}`, window_start: MARKER_WINDOW, count: 1 })
      .onConflictDoNothing({ target: [schema.usageCounter.key, schema.usageCounter.window_start] })
      .returning();
    if (marker.length === 0) continue;

    const zips = teaser?.zips?.length ? ` (ZIP ${teaser.zips.slice(0, 4).join(", ")})` : "";
    const unsubUrl = `${b0}/api/unsubscribe?token=${encodeURIComponent(signBuyerUnsub(b.email))}`;
    const res = await sendEmail({
      to: b.email,
      subject: `New homeowner address list near you — ${pkg.geography_label ?? pkg.zip ?? "your area"}`,
      html:
        `<p>${b.company_name} — a new residential opportunity report just went live in your area:</p>` +
        `<p><strong>${pkg.name}</strong><br>` +
        `${pkg.lead_count} verified addresses${zips} — recent home sales from county deed records, ` +
        `each with the sale date, estimated home value, and lot size. New owners hire lawn care, ` +
        `pest control, cleaners, and fencing in their first months.</p>` +
        `<p><strong>${price}</strong> for the full list + CSV download.</p>` +
        `<p><a href="${b0}/buyers/residential">See the report</a></p>` +
        `<p style="color:#888;font-size:12px">You get these because you turned on new-job alerts. ` +
        `<a href="${unsubUrl}">Unsubscribe with one click</a> or manage alerts in <a href="${b0}/buyers">your dashboard</a>.</p>`,
      tags: { kind: "residential_alert" },
      logAs: { kind: "res_publish_alert", buyerId: b.id, refId: pkg.id },
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (res.ok) sent++;
  }
  return { matched, sent };
}
