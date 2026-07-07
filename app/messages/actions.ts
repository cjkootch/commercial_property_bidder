"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, chatMessage } from "@/lib/db/schema";
import { sendEmail } from "@/lib/integrations/resend";
import { getDefaultCompany } from "@/lib/db/queries";

// Operator chat replies. The /messages area sits behind the operator cookie
// (middleware), so no extra auth here.

function baseUrl(): string {
  const envBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (envBase && !/localhost|127\.0\.0\.1/.test(envBase)) return envBase;
  const host = headers().get("host");
  return host ? `https://${host}` : "https://greenkeep.us";
}

export async function replyToBuyer(buyerId: string, formData: FormData): Promise<void> {
  const body = ((formData.get("body") as string) || "").trim().slice(0, 4000);
  if (!body) return;
  const [b] = await db.select().from(buyer).where(eq(buyer.id, buyerId)).limit(1);
  if (!b) return;

  await db.insert(chatMessage).values({ buyer_id: b.id, sender: "operator", body });
  // Their unread buyer messages are answered — clear the inbox count.
  await db
    .update(chatMessage)
    .set({ read_at: new Date() })
    .where(and(eq(chatMessage.buyer_id, b.id), eq(chatMessage.sender, "buyer"), isNull(chatMessage.read_at)));

  const co = await getDefaultCompany();
  await sendEmail({
    to: b.email,
    subject: `Reply from ${co?.name ?? "Greenkeep"}`,
    html:
      `<p>${body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>` +
      `<p style="color:#888;font-size:12px">Reply in your <a href="${baseUrl()}/buyers">dashboard chat</a>, or just answer this email.</p>`,
    tags: { kind: "chat_reply" },
  }).catch(() => null);

  revalidatePath(`/messages/${buyerId}`);
  revalidatePath("/messages");
}

export async function markThreadRead(buyerId: string): Promise<void> {
  await db
    .update(chatMessage)
    .set({ read_at: new Date() })
    .where(and(eq(chatMessage.buyer_id, buyerId), eq(chatMessage.sender, "buyer"), isNull(chatMessage.read_at)));
  revalidatePath("/messages");
}
