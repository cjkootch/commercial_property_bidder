import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, chatMessage, leadUnlock } from "@/lib/db/schema";
import { markThreadRead, replyToBuyer } from "../actions";

// Operator thread view: full history + reply box. Opening the thread marks
// the buyer's messages read.
export const dynamic = "force-dynamic";

export default async function MessageThread({ params }: { params: { buyerId: string } }) {
  const [b] = await db.select().from(buyer).where(eq(buyer.id, params.buyerId)).limit(1);
  if (!b) notFound();

  await markThreadRead(b.id);
  const msgs = await db
    .select()
    .from(chatMessage)
    .where(eq(chatMessage.buyer_id, b.id))
    .orderBy(asc(chatMessage.created_at));
  const unlocks = await db.select().from(leadUnlock).where(eq(leadUnlock.buyer_id, b.id));

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/messages" className="text-sm text-gray-500 hover:text-gray-800">
        ← All messages
      </Link>
      <div className="mt-3 rounded-xl border border-gray-200 bg-white p-5">
        <div className="font-semibold text-gray-900">{b.company_name}</div>
        <div className="mt-0.5 text-sm text-gray-500">
          {b.email}
          {b.city ? ` · ${b.city}` : ""} · {unlocks.length} unlock{unlocks.length === 1 ? "" : "s"} ·
          credit ${Math.round(b.credit_cents / 100)}
          {b.notify ? " · alerts on" : " · alerts off"}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {msgs.map((m) => (
          <div
            key={m.id}
            className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${
              m.sender === "operator"
                ? "ml-auto bg-brand text-white"
                : "border border-gray-200 bg-white text-gray-800"
            }`}
          >
            <div className="whitespace-pre-wrap">{m.body}</div>
            <div className={`mt-1 text-[10px] ${m.sender === "operator" ? "text-white/70" : "text-gray-400"}`}>
              {m.created_at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </div>
          </div>
        ))}
      </div>

      <form action={replyToBuyer.bind(null, b.id)} className="mt-5 flex gap-2">
        <textarea
          name="body"
          required
          rows={2}
          maxLength={4000}
          placeholder="Reply — also emailed to the buyer…"
          className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
        <button className="self-end rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
          Send
        </button>
      </form>
    </div>
  );
}
