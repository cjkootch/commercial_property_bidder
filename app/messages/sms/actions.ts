"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyerOutreach, prospectCompany, smsSend } from "@/lib/db/schema";
import { sendSms, toE164 } from "@/lib/integrations/twilio";
import { openerFor, queueSentToday, TEXT_QUEUE_DAILY_CAP } from "@/lib/sms/queue";
import { draftSmsReply } from "@/lib/integrations/claude";

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

/** One tap = one first-touch opener from the text queue. The message is
 *  rebuilt server-side from the company row (the client only names the
 *  company), and a daily cap keeps volume conversation-shaped. */
export async function sendQueuedText(formData: FormData): Promise<void> {
  const id = (formData.get("companyId") as string) || "";
  if (!id) redirect("/messages/sms");

  const cap = TEXT_QUEUE_DAILY_CAP();
  if ((await queueSentToday()) >= cap) {
    redirect(`/messages/sms?q=${encodeURIComponent(`daily cap reached (${cap})`)}`);
  }

  const [p] = await db.select().from(prospectCompany).where(eq(prospectCompany.id, id)).limit(1);
  if (!p?.phone) redirect(`/messages/sms?q=no+phone+on+file`);

  const res = await sendSms({
    to: p.phone,
    body: openerFor(p.name, p.office_city),
    kind: "text_queue",
    companyKey: p.key,
    refId: p.id,
  });
  if (!res.ok) redirect(`/messages/sms?q=${encodeURIComponent(res.error.slice(0, 80))}`);
  revalidatePath("/messages/sms");
  redirect(`/messages/sms?t=${encodeURIComponent(toE164(p.phone)!)}&q=sent`);
}

/** AI-drafted reply (Claude): builds the draft from the thread + company
 *  context and returns it via the URL for the operator to review/edit in the
 *  compose box. Never sends. */
export async function draftAiReply(formData: FormData): Promise<void> {
  const phone = toE164((formData.get("phone") as string) || "");
  if (!phone) redirect("/messages/sms");

  const digits = phone.replace(/\D/g, "").replace(/^1/, "");
  const [companies, thread] = await Promise.all([
    db
      .select({
        key: prospectCompany.key,
        name: prospectCompany.name,
        trade: prospectCompany.trade,
        office_city: prospectCompany.office_city,
        phone: prospectCompany.phone,
      })
      .from(prospectCompany),
    db
      .select({ direction: smsSend.direction, body: smsSend.body, created_at: smsSend.created_at })
      .from(smsSend)
      .where(eq(smsSend.phone, phone))
      .orderBy(smsSend.created_at),
  ]);
  const match = companies.find(
    (c) => (c.phone ?? "").replace(/\D/g, "").replace(/^1/, "") === digits
  );

  let claimUrl: string | null = null;
  if (match) {
    const offers = await db
      .select({ claim_url: buyerOutreach.claim_url, sent_at: buyerOutreach.sent_at })
      .from(buyerOutreach)
      .where(eq(buyerOutreach.company_key, match.key))
      .orderBy(desc(buyerOutreach.sent_at))
      .limit(10);
    claimUrl = offers.find((o) => o.claim_url)?.claim_url ?? null;
  }

  const draft = await draftSmsReply({
    companyName: match?.name ?? null,
    city: match?.office_city ?? null,
    trade: match?.trade ?? null,
    claimUrl,
    thread,
  });
  const q = draft
    ? `draft=${encodeURIComponent(draft)}`
    : `sms=${encodeURIComponent("AI draft failed — check ANTHROPIC_API_KEY")}`;
  redirect(`/messages/sms?t=${encodeURIComponent(phone)}&${q}`);
}
