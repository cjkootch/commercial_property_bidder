import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, leadUnlock, prospectCompany } from "@/lib/db/schema";
import { companyKey } from "@/lib/leads/companies";

// Operator roster of buyer accounts: who signed up, from where, what they've
// unlocked and spent. Newest first — this is the page to watch after a blast.
export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d
    ? d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

export default async function CustomersPage() {
  const buyers = await db.select().from(buyer).orderBy(desc(buyer.created_at)).limit(500);

  const unlockAgg = await db
    .select({
      buyer_id: leadUnlock.buyer_id,
      unlocks: sql<number>`count(*)`,
      paid: sql<number>`count(*) filter (where ${leadUnlock.kind} <> 'free')`,
      spent_cents: sql<number>`coalesce(sum(${leadUnlock.price_cents}), 0)`,
    })
    .from(leadUnlock)
    .groupBy(leadUnlock.buyer_id);
  const agg = new Map(unlockAgg.map((a) => [a.buyer_id, a]));

  // Company-graph profiles so the name can drill into the full outreach
  // journey. Linked accounts match by buyer_id; direct signups fall back to
  // the normalized-name key (same key campaigns use).
  const profiles = await db
    .select({ id: prospectCompany.id, key: prospectCompany.key, buyer_id: prospectCompany.buyer_id })
    .from(prospectCompany);
  const profileByBuyer = new Map(profiles.filter((p) => p.buyer_id).map((p) => [p.buyer_id, p.id]));
  const profileByKey = new Map(profiles.map((p) => [p.key, p.id]));
  const profileFor = (b: { id: string; company_name: string }) =>
    profileByBuyer.get(b.id) ?? profileByKey.get(companyKey(b.company_name)) ?? null;

  const totalSpent = unlockAgg.reduce((s, a) => s + Number(a.spent_cents), 0) / 100;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Customers</h1>
      <p className="mt-1 text-sm text-gray-500">
        {buyers.length} account{buyers.length === 1 ? "" : "s"} · $
        {totalSpent.toLocaleString()} lead revenue all-time
      </p>

      <div className="mt-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2.5 font-medium">Company</th>
              <th className="px-3 py-2.5 font-medium">Contact</th>
              <th className="px-3 py-2.5 font-medium">Trade</th>
              <th className="px-3 py-2.5 font-medium">City</th>
              <th className="px-3 py-2.5 text-right font-medium">Unlocks</th>
              <th className="px-3 py-2.5 text-right font-medium">Spent</th>
              <th className="px-3 py-2.5 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {buyers.map((b) => {
              const a = agg.get(b.id);
              const spent = a ? Number(a.spent_cents) / 100 : 0;
              return (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    {profileFor(b) ? (
                      <Link
                        href={`/companies/${profileFor(b)}`}
                        className="font-medium text-gray-900 hover:text-brand hover:underline"
                      >
                        {b.company_name}
                      </Link>
                    ) : (
                      <div className="font-medium text-gray-900">{b.company_name}</div>
                    )}
                    <div className="text-xs text-gray-400">
                      {b.notify ? "alerts on" : "alerts off"}
                      {b.credit_cents > 0 ? ` · $${(b.credit_cents / 100).toLocaleString()} credit` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-gray-600">{b.email}</div>
                    <div className="text-xs text-gray-400">
                      {b.contact_name ?? ""}
                      {b.phone ? `${b.contact_name ? " · " : ""}${b.phone}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-3 capitalize text-gray-600">{b.trade}</td>
                  <td className="px-3 py-3 text-gray-600">{b.city ?? "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {a ? Number(a.unlocks) : 0}
                    {a && Number(a.paid) > 0 ? (
                      <span className="text-xs text-green-700"> ({Number(a.paid)} paid)</span>
                    ) : null}
                  </td>
                  <td
                    className={`px-3 py-3 text-right tabular-nums ${spent > 0 ? "font-semibold text-green-700" : "text-gray-400"}`}
                  >
                    ${spent.toLocaleString()}
                  </td>
                  <td className="px-3 py-3 text-gray-500">{fmt(b.created_at)}</td>
                </tr>
              );
            })}
            {buyers.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">
                  No accounts yet — they&apos;ll appear here the moment someone claims a lead.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
