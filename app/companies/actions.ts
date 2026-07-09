"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { prospectCompany } from "@/lib/db/schema";

// Operator verdicts on the company graph: a blocked profile never receives
// another campaign email (the qualifier skips it in every run, every trade).
// Middleware already gates /companies to the operator; these actions are only
// reachable from those pages.

export async function blockCompany(formData: FormData): Promise<void> {
  const id = (formData.get("id") as string) || "";
  const reason = ((formData.get("reason") as string) || "").trim().slice(0, 200) || "operator verdict";
  if (!id) return;
  await db
    .update(prospectCompany)
    .set({ blocked_at: new Date(), blocked_reason: reason, updated_at: new Date() })
    .where(eq(prospectCompany.id, id));
  revalidatePath("/companies");
  revalidatePath(`/companies/${id}`);
}

export async function unblockCompany(formData: FormData): Promise<void> {
  const id = (formData.get("id") as string) || "";
  if (!id) return;
  await db
    .update(prospectCompany)
    .set({ blocked_at: null, blocked_reason: null, updated_at: new Date() })
    .where(eq(prospectCompany.id, id));
  revalidatePath("/companies");
  revalidatePath(`/companies/${id}`);
}
