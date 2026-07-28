"use server";

// Company-page server actions. Every one re-verifies the session (the edge
// middleware is a redirect convenience, not the security boundary) and every
// mutation that changes meaning also writes to the timeline, the audit log, or
// both.

import { revalidatePath } from "next/cache";
import { requireUser } from "../../auth/session";
import { logActivity } from "../../crm/activity";
import { setFieldValue } from "../../crm/custom-fields";
import { blockCompany, unblockCompany } from "../../crm/companies";

function str(fd: FormData, k: string): string {
  const v = fd.get(k);
  if (v === null || String(v).trim() === "") throw new Error(`Missing field: ${k}`);
  return String(v).trim();
}

export async function logCallAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const companyId = str(formData, "companyId");
  const contactId = (formData.get("contactId") as string | null) || null;
  await logActivity({
    companyId,
    contactId,
    kind: "call",
    subject: "Call",
    body: str(formData, "body"),
    actorUserId: user.id,
  });
  revalidatePath(`/companies/${companyId}`);
}

export async function logNoteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const companyId = str(formData, "companyId");
  await logActivity({
    companyId,
    kind: "note",
    body: str(formData, "body"),
    actorUserId: user.id,
  });
  revalidatePath(`/companies/${companyId}`);
}

/** Log a physical letter — first-class in origination, where mail still works. */
export async function logLetterAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const companyId = str(formData, "companyId");
  await logActivity({
    companyId,
    contactId: (formData.get("contactId") as string | null) || null,
    kind: "letter",
    subject: (formData.get("subject") as string | null) || "Letter sent",
    body: (formData.get("body") as string | null) || null,
    actorUserId: user.id,
  });
  revalidatePath(`/companies/${companyId}`);
}

export async function setCustomFieldAction(formData: FormData): Promise<void> {
  await requireUser();
  const companyId = str(formData, "companyId");
  await setFieldValue({
    defId: str(formData, "defId"),
    recordId: str(formData, "recordId"),
    // Empty string is a legitimate "clear", so read it raw rather than via str().
    raw: formData.get("value"),
    expectEntity: "company",
  });
  revalidatePath(`/companies/${companyId}`);
}

export async function blockCompanyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData, "id");
  await blockCompany({ id, reason: str(formData, "reason"), actorUserId: user.id });
  revalidatePath(`/companies/${id}`);
  revalidatePath("/companies");
}

export async function unblockCompanyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData, "id");
  await unblockCompany(id, user.id);
  revalidatePath(`/companies/${id}`);
  revalidatePath("/companies");
}
