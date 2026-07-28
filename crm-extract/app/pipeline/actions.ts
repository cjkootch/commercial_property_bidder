"use server";

// Stage moves. A stage change is a real event in the record's history, so it
// writes a timeline row naming both stages — "why is this in nurture?" has to be
// answerable later, and a bare updated_at bump doesn't answer it.

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { deal, pipelineStage } from "../../db/schema";
import { requireUser } from "../../auth/session";
import { logActivity } from "../../crm/activity";
import { logAudit } from "../../crm/audit";

export async function moveDealAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const dealId = String(formData.get("dealId") ?? "").trim();
  const stageId = String(formData.get("stageId") ?? "").trim();
  if (!dealId || !stageId) throw new Error("dealId and stageId are required");

  const [current] = await db
    .select({ d: deal, stageLabel: pipelineStage.label })
    .from(deal)
    .leftJoin(pipelineStage, eq(deal.stage_id, pipelineStage.id))
    .where(eq(deal.id, dealId))
    .limit(1);
  if (!current) throw new Error("Deal not found");
  if (current.d.stage_id === stageId) return; // no-op, don't write a phantom event

  const [next] = await db
    .select()
    .from(pipelineStage)
    .where(eq(pipelineStage.id, stageId))
    .limit(1);
  if (!next) throw new Error("Stage not found");

  await db
    .update(deal)
    .set({
      stage_id: stageId,
      stage_changed_at: new Date(),
      // Terminal stages stamp a close date; moving back out clears it.
      closed_at: next.kind === "won" || next.kind === "lost" ? new Date() : null,
      updated_at: new Date(),
    })
    .where(eq(deal.id, dealId));

  await logActivity({
    companyId: current.d.company_id,
    dealId,
    kind: "stage_change",
    subject: `${current.stageLabel ?? "?"} → ${next.label}`,
    actorUserId: user.id,
  });
  await logAudit({
    actorUserId: user.id,
    action: "deal.stage_change",
    entity: "deal",
    recordId: dealId,
    before: { stage: current.stageLabel },
    after: { stage: next.label },
  });

  revalidatePath("/pipeline");
  revalidatePath(`/companies/${current.d.company_id}`);
}
