import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, buyerOutreach, prospectCompany } from "@/lib/db/schema";
import { TRADES, asTrade } from "@/lib/leads/trades";

// The company graph: every company we've pitched, with identity + the full
// cross-campaign journey (sends/opens/clicks rolled up from buyer_outreach,
// claim-page views and account linkage from the profile). Default order is
// the CALL LIST: engaged-but-unconverted companies first.
export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: { trade?: string };
}) {
  const profiles = await db.select().from(prospectCompany).orderBy(desc(prospectCompany.updated_at)).limit(1000);
  const outreach = await db
    .select({
      key: buyerOutreach.company_key,
      status: buyerOutreach.status,
      opened_at: buyerOutreach.opened_at,
      clicked_at: buyerOutreach.clicked_at,
      sent_at: buyerOutreach.sent_at,
    })
    .from(buyerOutreach);
  const buyers = await db.select({ id: buyer.id, company_name: buyer.company_name }).from(buyer);
  const buyerName = new Map(buyers.map((b) => [b.id, b.company_name]));

  const funnel = new Map<string, { sends: number; opens: number; clicks: number; bounced: boolean; lastSent: Date | null }>();
  for (const r of outreach) {
    const f = funnel.get(r.key) ?? { sends: 0, opens: 0, clicks: 0, bounced: false, lastSent: null };
    if (r.status === "sent" || r.status === "bounced") f.sends++;
    if (r.opened_at) f.opens++;
    if (r.clicked_at) f.clicks++;
    if (r.status === "bounced") f.bounced = true;
    if (r.sent_at && (!f.lastSent || r.sent_at > f.lastSent)) f.lastSent = r.sent_at;
    funnel.set(r.key, f);
  }

  const tradeFilter = searchParams.trade ? asTrade(searchParams.trade) : null;
  const rows = profiles
    .filter((p) => !tradeFilter || p.trade === tradeFilter)
    .map((p) => {
      const f = funnel.get(p.key) ?? { sends: 0, opens: 0, clicks: 0, bounced: false, lastSent: null };
      // Call-list score: reading the offer (claim view) is worth the most,
      // clicks next, opens least; converted accounts drop to the bottom
      // (they're customers now, not calls).
      const score = p.buyer_id ? -1 : p.claim_views * 5 + f.clicks * 3 + f.opens;
      return { p, f, score };
    })
    .sort((a, b) => b.score - a.score || (b.f.lastSent?.getTime() ?? 0) - (a.f.lastSent?.getTime() ?? 0));

  const tradeCounts = new Map<string, number>();
  for (const p of profiles) tradeCounts.set(p.trade, (tradeCounts.get(p.trade) ?? 0) + 1);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Companies</h1>
      <p className="mt-1 text-sm text-gray-500">
        Every company we&apos;ve pitched, ranked as a call list: read-the-offer and clicked-but-
        never-claimed companies first, converted accounts last.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <a href="/companies" className={`rounded-full px-2.5 py-1 font-semibold ${!tradeFilter ? "bg-brand text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
          All ({profiles.length})
        </a>
        {[...tradeCounts.entries()].map(([t, n]) => (
          <a key={t} href={`/companies?trade=${t}`} className={`rounded-full px-2.5 py-1 font-semibold ${tradeFilter === t ? "bg-brand text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
            {TRADES[asTrade(t)].label} ({n})
          </a>
        ))}
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2.5 font-medium">Company</th>
              <th className="px-3 py-2.5 font-medium">Trade</th>
              <th className="px-3 py-2.5 text-right font-medium">Sends</th>
              <th className="px-3 py-2.5 text-right font-medium">Opens</th>
              <th className="px-3 py-2.5 text-right font-medium">Clicks</th>
              <th className="px-3 py-2.5 text-right font-medium">Offer views</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map(({ p, f, score }) => (
              <tr key={p.id} className={score >= 5 ? "bg-amber-50/60" : "hover:bg-gray-50"}>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{p.name}</div>
                  <div className="text-xs text-gray-400">
                    {p.office_city ?? ""}
                    {p.email ? ` · ${p.email}` : ""}
                    {p.phone ? ` · ${p.phone}` : ""}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-bold text-brand">
                    {TRADES[asTrade(p.trade)].label}
                  </span>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{f.sends}</td>
                <td className="px-3 py-3 text-right tabular-nums">{f.opens}</td>
                <td className="px-3 py-3 text-right tabular-nums">{f.clicks}</td>
                <td className={`px-3 py-3 text-right tabular-nums ${p.claim_views ? "font-bold text-amber-700" : ""}`}>
                  {p.claim_views}
                  {p.last_claim_view_at ? <span className="ml-1 text-[10px] font-normal text-gray-400">{fmt(p.last_claim_view_at)}</span> : null}
                </td>
                <td className="px-3 py-3 text-xs">
                  {p.buyer_id ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-800">
                      ACCOUNT{buyerName.get(p.buyer_id) ? ` · ${buyerName.get(p.buyer_id)}` : ""}
                    </span>
                  ) : f.bounced ? (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">BOUNCED</span>
                  ) : score >= 5 ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">📞 CALL</span>
                  ) : (
                    <span className="text-gray-400">prospect</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">
                  Profiles appear as campaigns send (and backfill from past sends).
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
