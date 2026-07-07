// Shared loader for the buyer support-chat widget: one thread per buyer,
// oldest-first, shaped for <ChatWidget mode="buyer">.

import { asc, eq } from "drizzle-orm";
import { db } from "./db";
import { chatMessage } from "./db/schema";
import type { ChatMsg } from "@/components/ChatWidget";

export async function loadBuyerChat(buyerId: string): Promise<ChatMsg[]> {
  const rows = await db
    .select()
    .from(chatMessage)
    .where(eq(chatMessage.buyer_id, buyerId))
    .orderBy(asc(chatMessage.created_at))
    .limit(200);
  return rows.map((m) => ({
    id: m.id,
    sender: m.sender,
    body: m.body,
    at: m.created_at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
  }));
}
