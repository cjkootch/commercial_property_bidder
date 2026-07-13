"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyerOutreach, prospectCompany, smsSend } from "@/lib/db/schema";
import { sendSms, toE164, isTextableLineType } from "@/lib/integrations/twilio";
import { openerFor, queueSentToday, TEXT_QUEUE_DAILY_CAP } from "@/lib/sms/queue";
import { draftSmsReply } from "@/lib/integrations/claude";
import { ensureOwnerCell } from "@/lib/sms/cell";
import { ensureLineTypeScreened } from "@/lib/sms/screen";
import { rateLimit } from "@/lib/ratelimit";

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

  // A stale queue panel (or a double-tap) must not send a second opener —
  // the "never texted" filter at render time isn't a server-side guarantee.
  const phoneE164 = toE164(p.phone);
  if (phoneE164) {
    const [prior] = await db
      .select({ id: smsSend.id })
      .from(smsSend)
      .where(and(eq(smsSend.phone, phoneE164), eq(smsSend.kind, "text_queue")))
      .limit(1);
    if (prior) {
      redirect(`/messages/sms?t=${encodeURIComponent(phoneE164)}&q=${encodeURIComponent("already opened with this number")}`);
    }
  }
  // Autopilot parity (2026-07-13): a manual tap used to blast the raw number on
  // file, bypassing the cell-first reveal + line screen the cron runs — so
  // manual fires landed on business landlines/VoIP and bounced. Do both here
  // too. Cell-first swaps in the owner's mobile where Apollo finds one; the
  // just-in-time screen then drops a number SMS can't reach BEFORE we burn a
  // cap slot on it.
  const cell = await ensureOwnerCell(
    {
      id: p.id,
      name: p.name,
      website: p.website,
      phone: p.phone,
      lineType: p.line_type,
      cellLookupAt: p.cell_lookup_at,
    },
    { apply: true }
  );
  const toPhone = cell.phone ?? p.phone;
  const lineType = await ensureLineTypeScreened(p.id, toPhone, cell.swapped ? null : cell.lineType);
  if (!isTextableLineType(lineType)) {
    const to = toE164(toPhone);
    redirect(
      `/messages/sms${to ? `?t=${encodeURIComponent(to)}&` : "?"}q=${encodeURIComponent(
        `skipped — that number is a ${lineType} and can't receive SMS (no mobile on file)`
      )}`
    );
  }

  // Same atomic daily ledger as the cron — the snapshot check above races.
  if (!(await rateLimit("smsqueue:day", cap, 86_400)).ok) {
    redirect(`/messages/sms?q=${encodeURIComponent(`daily cap reached (${cap})`)}`);
  }

  const res = await sendSms({
    to: toPhone,
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
    ? `draft=${encodeURIComponent(draft.text)}`
    : `sms=${encodeURIComponent("AI draft failed — check ANTHROPIC_API_KEY")}`;
  redirect(`/messages/sms?t=${encodeURIComponent(phone)}&${q}`);
}
