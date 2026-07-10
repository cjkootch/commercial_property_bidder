"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { residentialPackage } from "@/lib/db/schema";

// Operator verdicts on residential packages: drafts from the weekly autopilot
// go on sale only through an explicit publish click here — same posture as
// campaign sends. Middleware already gates /packages to the operator.

const ALLOWED = ["draft", "published", "sold_out", "archived"] as const;
type Status = (typeof ALLOWED)[number];

export async function setPackageStatus(formData: FormData): Promise<void> {
  const id = (formData.get("id") as string) || "";
  const status = (formData.get("status") as string) || "";
  if (!id || !ALLOWED.includes(status as Status)) return;
  await db
    .update(residentialPackage)
    .set({ status: status as Status, updated_at: new Date() })
    .where(eq(residentialPackage.id, id));
  // Publish IS the send gate: alert opted-in buyers in reach, once per buyer
  // per package (the alert lib dedupes, so re-publishing never re-emails).
  if (status === "published") {
    const { notifyBuyersOfPackagePublish } = await import("@/lib/residential/alerts");
    await notifyBuyersOfPackagePublish(id).catch(() => null);
  }
  revalidatePath("/packages");
}

/** Operator price override — the economics engine sets the draft price, the
 *  operator has the final word before (or after) publish. */
export async function setPackagePrice(formData: FormData): Promise<void> {
  const id = (formData.get("id") as string) || "";
  const usd = Number(formData.get("usd"));
  if (!id || !Number.isFinite(usd) || usd <= 0 || usd > 5000) return;
  await db
    .update(residentialPackage)
    .set({ price_cents: Math.round(usd * 100), updated_at: new Date() })
    .where(eq(residentialPackage.id, id));
  revalidatePath("/packages");
}
