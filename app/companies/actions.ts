"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyerOutreach, prospectCompany, prospectContact } from "@/lib/db/schema";
import { sendEmail } from "@/lib/integrations/resend";
import { sendSms, toE164 } from "@/lib/integrations/twilio";

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

/** Operator 1:1 reply from the company profile — sends from the verified
 *  domain sender (RESEND_FROM, i.e. leads@), logs the message into the
 *  outreach history (property-less row = "Direct reply"), and tracks opens
 *  via the normal Resend webhook. A personal reply to their inquiry — no
 *  unsubscribe footer, no marketing framing. */
export async function replyToCompany(formData: FormData): Promise<void> {
  const id = (formData.get("id") as string) || "";
  const subject = ((formData.get("subject") as string) || "").trim().slice(0, 200);
  const body = ((formData.get("body") as string) || "").trim().slice(0, 8000);
  if (!id || !subject || !body) redirect(`/companies/${id}?reply=missing`);

  const [p] = await db.select().from(prospectCompany).where(eq(prospectCompany.id, id)).limit(1);
  if (!p?.email) redirect(`/companies/${id}?reply=noemail`);

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;line-height:1.55;">` +
    body
      .split(/\n\n+/)
      .map(
        (para) =>
          `<p style="margin:0 0 14px;">${esc(para)
            .replace(/(https?:\/\/[^\s]+)/g, (u) => `<a href="${u}" style="color:#2f7d4f;font-weight:600;">${u}</a>`)
            .replace(/\n/g, "<br>")}</p>`
      )
      .join("") +
    `</div>`;

  const res = await sendEmail({
    to: p.email,
    subject,
    html,
    tags: { kind: "operator_reply" },
  });
  if (!res.ok) redirect(`/companies/${id}?reply=failed`);

  await db.insert(buyerOutreach).values({
    property_id: null,
    company_key: p.key,
    company_name: p.name,
    website: p.website,
    email: p.email,
    status: "sent",
    sent_at: new Date(),
    resend_message_id: res.ok ? res.id : null,
    message: `SUBJECT: ${subject}\n\n${body}`,
  });
  revalidatePath(`/companies/${id}`);
  redirect(`/companies/${id}?reply=sent`);
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

/** Operator 1:1 SMS from the company profile. Twilio-backed, logged to
 *  sms_send, opt-outs honored. One-to-one replies/follow-ups only — bulk
 *  cold texting is a TCPA problem email doesn't have; don't build it. */
export async function smsCompany(formData: FormData): Promise<void> {
  const id = (formData.get("id") as string) || "";
  const body = ((formData.get("body") as string) || "").trim().slice(0, 1200);
  if (!id || !body) redirect(`/companies/${id}?sms=missing`);

  const [p] = await db.select().from(prospectCompany).where(eq(prospectCompany.id, id)).limit(1);
  if (!p?.phone) redirect(`/companies/${id}?sms=nophone`);

  const res = await sendSms({
    to: p.phone,
    body,
    kind: "company_sms",
    companyKey: p.key,
    refId: p.id,
  });
  if (!res.ok) redirect(`/companies/${id}?sms=${encodeURIComponent(res.error.slice(0, 80))}`);
  revalidatePath(`/companies/${id}`);
  redirect(`/companies/${id}?sms=sent`);
}

/** Add a named person to a prospect company. The company row carries one
 *  scraped email and one scraped main line; this is where the human who
 *  actually picks up goes.
 *
 *  Idempotent on (company, email) via the partial unique index, so a repeated
 *  submit updates rather than duplicating. Contacts WITHOUT an email are not
 *  covered by that index — deliberately, since several email-less contacts per
 *  company is normal — so those are matched on name before inserting. */
export async function addProspectContact(formData: FormData): Promise<void> {
  const companyId = String(formData.get("companyId") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim().slice(0, 120);
  if (!companyId || !fullName) return;

  const clean = (k: string, max = 200) => {
    const v = String(formData.get(k) ?? "").trim().slice(0, max);
    return v || null;
  };
  const email = clean("email")?.toLowerCase() ?? null;
  // Store the phone as given AND normalized: toE164 returns null for anything
  // that isn't a dialable US number, and a contact with a foreign or extension
  // number is still worth keeping — just not worth texting.
  const rawPhone = clean("phone", 40);
  const phone = rawPhone ? toE164(rawPhone) ?? rawPhone : null;

  const values = {
    prospect_company_id: companyId,
    full_name: fullName,
    title: clean("title", 120),
    email,
    phone,
    notes: clean("notes", 1000),
    is_primary: formData.get("is_primary") === "on",
    source: clean("source", 40) ?? "manual",
  };

  if (email) {
    await db
      .insert(prospectContact)
      .values(values)
      .onConflictDoUpdate({
        target: [prospectContact.prospect_company_id, prospectContact.email],
        set: { ...values, updated_at: new Date() },
      });
  } else {
    const [existing] = await db
      .select({ id: prospectContact.id })
      .from(prospectContact)
      .where(
        and(
          eq(prospectContact.prospect_company_id, companyId),
          eq(prospectContact.full_name, fullName)
        )
      )
      .limit(1);
    if (existing) {
      await db
        .update(prospectContact)
        .set({ ...values, updated_at: new Date() })
        .where(eq(prospectContact.id, existing.id));
    } else {
      await db.insert(prospectContact).values(values);
    }
  }

  revalidatePath(`/companies/${companyId}`);
}

/** Remove a contact. The person left the company, or the row was a mistake. */
export async function deleteProspectContact(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!id) return;
  await db.delete(prospectContact).where(eq(prospectContact.id, id));
  if (companyId) revalidatePath(`/companies/${companyId}`);
}
