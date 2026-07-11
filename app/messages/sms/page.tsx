import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { prospectCompany, smsOptOut, smsSend } from "@/lib/db/schema";
import { replyInboxSms } from "./actions";

// Consolidated SMS inbox — every text conversation in one place (iPhone
// style): thread list on the left, active conversation + reply box on the
// right. Threads are keyed by the counterparty's phone, so numbers that
// don't match a company profile still get a home here (the company-page
// thread view only covers matched numbers).
export const dynamic = "force-dynamic";

const fmtTime = (d: Date) =>
  d.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default async function SmsInbox({
  searchParams,
}: {
  searchParams: { t?: string; sms?: string };
}) {
  const [rows, companies, optOuts] = await Promise.all([
    db.select().from(smsSend).orderBy(desc(smsSend.created_at)).limit(2000),
    db
      .select({
        id: prospectCompany.id,
        key: prospectCompany.key,
        name: prospectCompany.name,
        phone: prospectCompany.phone,
      })
      .from(prospectCompany),
    db.select({ phone: smsOptOut.phone }).from(smsOptOut),
  ]);

  const optedOut = new Set(optOuts.map((o) => o.phone));
  const byKey = new Map(companies.map((c) => [c.key, c]));
  const byDigits = new Map(
    companies
      .filter((c) => c.phone)
      .map((c) => [c.phone!.replace(/\D/g, "").replace(/^1/, ""), c])
  );
  const companyFor = (phone: string, companyKey: string | null) =>
    (companyKey ? byKey.get(companyKey) : undefined) ??
    byDigits.get(phone.replace(/\D/g, "").replace(/^1/, ""));

  // Group into threads by counterparty phone; rows arrive newest-first.
  type Row = (typeof rows)[number];
  const threads = new Map<string, Row[]>();
  for (const r of rows) {
    const t = threads.get(r.phone) ?? [];
    t.push(r);
    threads.set(r.phone, t);
  }
  const list = [...threads.entries()].map(([phone, msgs]) => {
    const co = companyFor(phone, msgs.find((m) => m.company_key)?.company_key ?? null);
    return {
      phone,
      msgs,
      last: msgs[0],
      needsReply: msgs[0].direction === "in",
      name: co?.name ?? phone,
      companyId: co?.id ?? null,
    };
  });
  // Newest activity first (rows were global-desc, so per-thread [0] is latest).
  list.sort((a, b) => b.last.created_at.getTime() - a.last.created_at.getTime());

  const active = searchParams.t ? list.find((t) => t.phone === searchParams.t) : undefined;
  const activeMsgs = active ? [...active.msgs].reverse() : []; // oldest → newest for display

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Messages</h1>
        <div className="flex overflow-hidden rounded-md border border-gray-300 text-xs font-semibold">
          <Link href="/messages" className="bg-white px-3 py-1.5 text-gray-600 hover:bg-gray-50">
            Buyer chats
          </Link>
          <span className="bg-brand px-3 py-1.5 text-white">Texts</span>
        </div>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Every SMS conversation, one inbox. Replies from prospects also land in your email.
      </p>

      {list.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          No text conversations yet. Send one from a company profile.
        </p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white md:grid md:grid-cols-[300px,1fr]">
          {/* Thread list — on mobile, hidden while a thread is open. */}
          <div
            className={`max-h-[70vh] divide-y divide-gray-100 overflow-y-auto md:border-r md:border-gray-200 ${
              active ? "hidden md:block" : ""
            }`}
          >
            {list.map((t) => (
              <Link
                key={t.phone}
                href={`/messages/sms?t=${encodeURIComponent(t.phone)}`}
                className={`block px-4 py-3 hover:bg-gray-50 ${
                  active?.phone === t.phone ? "bg-brand/5" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-gray-900">{t.name}</span>
                  <span className="shrink-0 text-[11px] text-gray-400">
                    {fmtTime(t.last.created_at)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  {t.needsReply ? (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-brand" title="Awaiting your reply" />
                  ) : null}
                  <span className="truncate text-sm text-gray-500">
                    {t.last.direction === "out" ? "You: " : ""}
                    {t.last.body}
                  </span>
                </div>
              </Link>
            ))}
          </div>

          {/* Active thread */}
          {active ? (
            <div className="flex max-h-[70vh] flex-col">
              <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
                <div className="min-w-0">
                  <Link href="/messages/sms" className="mr-2 text-sm text-gray-400 hover:text-gray-600 md:hidden">
                    ←
                  </Link>
                  <span className="font-semibold text-gray-900">{active.name}</span>
                  {active.name !== active.phone ? (
                    <span className="ml-2 text-xs text-gray-400">{active.phone}</span>
                  ) : null}
                </div>
                {active.companyId ? (
                  <Link
                    href={`/companies/${active.companyId}`}
                    className="shrink-0 text-xs font-semibold text-brand hover:underline"
                  >
                    Company profile →
                  </Link>
                ) : (
                  <span className="shrink-0 text-[11px] text-gray-400">no company match</span>
                )}
              </div>

              <div className="flex-1 space-y-1.5 overflow-y-auto px-4 py-3">
                {activeMsgs.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === "in" ? "justify-start" : "justify-end"}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl px-3 py-1.5 text-sm ${
                        m.direction === "in"
                          ? "rounded-bl-sm bg-gray-100 text-gray-800"
                          : "rounded-br-sm bg-brand text-white"
                      }`}
                    >
                      {m.body}
                      <div
                        className={`mt-0.5 text-[10px] ${
                          m.direction === "in" ? "text-gray-400" : "text-white/70"
                        }`}
                      >
                        {fmtTime(m.created_at)}
                        {m.direction === "out" ? ` · ${m.status}` : ""}
                        {m.error_code ? ` (${m.error_code})` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-100 px-4 py-3">
                {searchParams.sms && searchParams.sms !== "sent" ? (
                  <p className="mb-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                    Not sent ({searchParams.sms === "missing" ? "message is required" : searchParams.sms}).
                  </p>
                ) : null}
                {optedOut.has(active.phone) ? (
                  <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                    This number replied STOP — sending is blocked until they text START.
                  </p>
                ) : (
                  <form action={replyInboxSms} className="flex items-end gap-2">
                    <input type="hidden" name="phone" value={active.phone} />
                    <textarea
                      name="body"
                      rows={2}
                      maxLength={1200}
                      placeholder="Text message"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      required
                    />
                    <button className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
                      Send
                    </button>
                  </form>
                )}
              </div>
            </div>
          ) : (
            <div className="hidden items-center justify-center p-12 text-sm text-gray-400 md:flex">
              Select a conversation
            </div>
          )}
        </div>
      )}
    </div>
  );
}
