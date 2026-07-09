import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, chatMessage } from "@/lib/db/schema";

// Operator inbox: one thread per buyer, newest activity first, unread counts.
export const dynamic = "force-dynamic";

export default async function MessagesInbox() {
  const msgs = await db.select().from(chatMessage).orderBy(desc(chatMessage.created_at)).limit(1000);
  const buyers = await db.select().from(buyer);
  const byId = new Map(buyers.map((b) => [b.id, b]));

  type Thread = { buyerId: string; last: typeof msgs[number]; unread: number; count: number };
  const threads = new Map<string, Thread>();
  for (const m of msgs) {
    const t = threads.get(m.buyer_id) ?? { buyerId: m.buyer_id, last: m, unread: 0, count: 0 };
    t.count++;
    if (m.sender === "buyer" && !m.read_at) t.unread++;
    threads.set(m.buyer_id, t);
  }
  const list = [...threads.values()];

  return (
    <div>
      <h1 className="text-2xl font-semibold">Messages</h1>
      <p className="mt-1 text-sm text-gray-500">
        Buyer chat threads — replies also go out by email.
      </p>

      {list.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          No messages yet. The chat widget lives on the homepage and the buyer portal.
        </p>
      ) : (
        <div className="mt-6 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {list.map((t) => {
            const b = byId.get(t.buyerId);
            return (
              <Link
                key={t.buyerId}
                href={`/messages/${t.buyerId}`}
                className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-gray-50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{b?.company_name ?? "Unknown"}</span>
                    <span className="truncate text-xs text-gray-400">{b?.email}</span>
                  </div>
                  <div className="mt-0.5 truncate text-sm text-gray-500">
                    {t.last.sender === "operator" ? "You: " : ""}
                    {t.last.body}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {t.unread > 0 ? (
                    <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white">
                      {t.unread}
                    </span>
                  ) : null}
                  <span className="text-xs text-gray-400">
                    {t.last.created_at.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" })}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
