"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { prospectCompany } from "@/lib/db/schema";
import { sendSms, toE164 } from "@/lib/integrations/twilio";

// Reply from the consolidated SMS inbox. The thread is keyed by the
// counterparty's phone; if that number belongs to a company profile the send
// is attributed to it (company_key) so the same thread shows on their page.

export async function replyInboxSms(formData: FormData): Promise<void> {
  const phone = toE164((formData.get("phone") as string) || "");
  const body = ((formData.get("body") as string) || "").trim().slice(0, 1200);
  if (!phone) redirect("/messages/sms");
  if (!body) redirect(`/messages/sms?t=${encodeURIComponent(phone)}&sms=missing`);

  const digits = phone.replace(/\D/g, "").replace(/^1/, "");
  const companies = await db
    .select({ key: prospectCompany.key, phone: prospectCompany.phone })
    .from(prospectCompany);
  const match = companies.find(
    (c) => (c.phone ?? "").replace(/\D/g, "").replace(/^1/, "") === digits
  );

  const res = await sendSms({
    to: phone,
    body,
    kind: "inbox_sms",
    companyKey: match?.key ?? null,
  });
  if (!res.ok) {
    redirect(`/messages/sms?t=${encodeURIComponent(phone)}&sms=${encodeURIComponent(res.error.slice(0, 80))}`);
  }
  revalidatePath("/messages/sms");
  redirect(`/messages/sms?t=${encodeURIComponent(phone)}&sms=sent`);
}
