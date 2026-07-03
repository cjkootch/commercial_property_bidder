"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { property } from "@/lib/db/schema";
import { sendProposalEmail } from "../properties/actions";

// Morning approval queue actions. Approve = THE explicit operator send approval
// (build spec §9) — it delegates to the same guarded sendProposalEmail used on
// the property page. A failed send leaves the item in the queue.

export async function approveAndSend(propertyId: string): Promise<void> {
  await sendProposalEmail(propertyId);
  revalidatePath("/queue");
  revalidatePath("/dashboard");
}

/** Remove from the queue without sending (back to proposal_ready). */
export async function skipQueued(propertyId: string): Promise<void> {
  await db
    .update(property)
    .set({ status: "proposal_ready", updated_at: new Date() })
    .where(eq(property.id, propertyId));
  revalidatePath("/queue");
}

/** Bulk-approve everything currently in the queue (sequential sends). */
export async function approveAllQueued(): Promise<void> {
  const rows = await db.select().from(property).where(eq(property.status, "outreach_drafted"));
  for (const p of rows) {
    await sendProposalEmail(p.id); // failures stay queued; successes advance to 'sent'
  }
  revalidatePath("/queue");
  revalidatePath("/dashboard");
}
