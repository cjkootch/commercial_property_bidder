"use server";

// Server actions for the revisit queue. Native <form action={...}> — no client
// JS, no form library. The source app used this pattern throughout and it is the
// right default for an internal tool: every mutation is a POST that works with
// JS disabled and needs no API route.
//
// EVERY action re-verifies the session (requireUser). The edge middleware only
// checks that a cookie exists; it is a redirect convenience, not the security
// boundary. Never rely on it here.

import { revalidatePath } from "next/cache";
import { requireUser } from "../../auth/session";
import {
  completeRevisit,
  setRevisit,
  snoozeRevisit,
  type RevisitEntity,
} from "../../crm/revisit";

function entityOf(v: FormDataEntryValue | null): RevisitEntity {
  const s = String(v ?? "");
  if (s === "company" || s === "contact" || s === "deal") return s;
  throw new Error(`Unknown revisit entity "${s}"`);
}

function str(fd: FormData, k: string): string {
  const v = fd.get(k);
  if (v === null || String(v).trim() === "") throw new Error(`Missing field: ${k}`);
  return String(v).trim();
}

export async function snoozeRevisitAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const days = Number(str(formData, "days"));
  if (!Number.isFinite(days) || days <= 0) throw new Error("days must be a positive number");
  await snoozeRevisit({
    entity: entityOf(formData.get("entity")),
    id: str(formData, "id"),
    companyId: str(formData, "companyId"),
    today: str(formData, "today"),
    days,
    note: (formData.get("note") as string | null) ?? null,
    actorUserId: user.id,
    userId: user.id,
  });
  revalidatePath("/revisits");
}

export async function completeRevisitAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await completeRevisit({
    entity: entityOf(formData.get("entity")),
    id: str(formData, "id"),
    companyId: str(formData, "companyId"),
    outcome: str(formData, "outcome"),
    actorUserId: user.id,
  });
  revalidatePath("/revisits");
}

/** Set or move a revisit from a record page. `date` empty = clear it. */
export async function setRevisitAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const raw = (formData.get("date") as string | null)?.trim() ?? "";
  const companyId = str(formData, "companyId");
  await setRevisit({
    entity: entityOf(formData.get("entity")),
    id: str(formData, "id"),
    companyId,
    date: raw === "" ? null : raw,
    note: (formData.get("note") as string | null) ?? null,
    userId: (formData.get("userId") as string | null) || user.id,
    actorUserId: user.id,
  });
  revalidatePath("/revisits");
  revalidatePath(`/companies/${companyId}`);
}
