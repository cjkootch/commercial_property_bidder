import { desc, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, buyerOutreach, prospectCompany } from "@/lib/db/schema";
import { TRADES, asTrade } from "@/lib/leads/trades";
import { blockCompany, unblockCompany } from "./actions";

// The company graph: every company we've pitched, with identity + the full
// cross-campaign journey (sends/opens/clicks rolled up from buyer_outreach,
// claim-page views and account linkage from the profile). Default order is
// the CALL LIST: engaged-but-unconverted companies first.
export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d ? d.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" }) : "—";

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: { trade?: string; q?: string };
}) {
  const q = (searchParams.q ?? "").trim();
  // Phone search on digits only, so "832-909-1591", "(832) 909 1591" and
  // "8329091591" all find the same company however the number was stored.
  // 7+ digits keeps a short numeric name fragment from matching every phone.
  const digits = q.replace(/\D/g, "");
  const search = q
    ? or(
        ilike(prospectCompany.name, `%${q}%`),
        ilike(prospectCompany.email, `%${q}%`),
        ilike(prospectCompany.website, `%${q}%`),
        ilike(prospectCompany.office_city, `%${q}%`),
        ilike(prospectCompany.key, `%${q}%`),
        ...(digits.length >= 7
          ? [
              sql`regexp_replace(coalesce(${prospectCompany.phone}, ''), '[^0-9]', '', 'g') like ${
                "%" + digits + "%"
              }`,
            ]
          : [])
      )
    : undefined;

  // Search runs in SQL, not over the loaded page: the 1000-row cap below is a
  // display limit for the default call list, and a search that only looked
  // inside it would silently fail to find anything older.
  const profiles = await db
    .select()
    .from(prospectCompany)
    .where(search)
    .orderBy(desc(prospectCompany.updated_at))
    .limit(q ? 200 : 1000);
  // Campaign rows only: operator 1:1 replies (claim_url NULL) carry tracking
  // too, but a personal reply must not inflate the funnel or the call-list
  // score (an auto-fired open on a reply is not campaign engagement).
  const outreach = (
    await db
      .select({
        key: buyerOutreach.company_key,
        status: buyerOutreach.status,
        opened_at: buyerOutreach.opened_at,
        clicked_at: buyerOutreach.clicked_at,
        sent_at: buyerOutreach.sent_at,
        claim_url: buyerOutreach.claim_url,
      })
      .from(buyerOutreach)
  ).filter((r) => r.claim_url);
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
      // (they're customers now, not calls) and blocked junk below them.
      const score = p.blocked_at ? -2 : p.buyer_id ? -1 : p.claim_views * 5 + f.clicks * 3 + f.opens;
      return { p, f, score };
    })
    .sort((a, b) => b.score - a.score || (b.f.lastSent?.getTime() ?? 0) - (a.f.lastSent?.getTime() ?? 0));

  // Counted in SQL over the WHOLE table, not over `profiles` — otherwise the
  // chips would report the search result's makeup (and, before search existed,
  // silently capped at the 1000 most recently updated).
  const tradeCountRows = await db
    .select({ trade: prospectCompany.trade, n: sql<number>`count(*)::int` })
    .from(prospectCompany)
    .groupBy(prospectCompany.trade);
  const tradeCounts = new Map(tradeCountRows.map((r) => [r.trade, r.n]));
  const totalCount = tradeCountRows.reduce((sum, r) => sum + r.n, 0);

  const withQ = (base: string) => (q ? `${base}${base.includes("?") ? "&" : "?"}q=${encodeURIComponent(q)}` : base);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Companies</h1>
      <p className="mt-1 text-sm text-gray-500">
        Every company we&apos;ve pitched, ranked as a call list: read-the-offer and clicked-but-
        never-claimed companies first, converted accounts last.
      </p>

      {/* Plain GET form: the search lives in the URL, so a result set is
          shareable, bookmarkable and survives a refresh. No client JS. */}
      <form method="GET" action="/companies" className="mt-3 flex flex-wrap items-center gap-2">
        {tradeFilter ? <input type="hidden" name="trade" value={tradeFilter} /> : null}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search name, email, phone, city, or website…"
          aria-label="Search companies"
          className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-1.5 text-sm placeholder:text-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
        <button className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90">
          Search
        </button>
        {q ? (
          <a
            href={tradeFilter ? `/companies?trade=${tradeFilter}` : "/companies"}
            className="text-sm text-gray-500 hover:text-gray-700 hover:underline"
          >
            Clear
          </a>
        ) : null}
        {q ? (
          <span className="text-xs text-gray-400">
            {rows.length} match{rows.length === 1 ? "" : "es"} for &ldquo;{q}&rdquo;
            {profiles.length === 200 ? " (showing first 200)" : ""}
          </span>
        ) : null}
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <a href={withQ("/companies")} className={`rounded-full px-2.5 py-1 font-semibold ${!tradeFilter ? "bg-brand text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
          All ({totalCount})
        </a>
        {[...tradeCounts.entries()].map(([t, n]) => (
          <a key={t} href={withQ(`/companies?trade=${t}`)} className={`rounded-full px-2.5 py-1 font-semibold ${tradeFilter === t ? "bg-brand text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
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
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map(({ p, f, score }) => (
              <tr key={p.id} className={score >= 5 ? "bg-amber-50/60" : "hover:bg-gray-50"}>
                <td className="px-4 py-3">
                  <a
                    href={`/companies/${p.id}`}
                    className="font-medium text-gray-900 hover:text-brand hover:underline"
                  >
                    {p.name}
                  </a>
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
                  {p.blocked_at ? (
                    <span className="rounded-full bg-gray-200 px-2 py-0.5 font-semibold text-gray-600">BLOCKED</span>
                  ) : p.buyer_id ? (
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
                <td className="px-3 py-3 text-right">
                  {p.buyer_id ? null : p.blocked_at ? (
                    <form action={unblockCompany}>
                      <input type="hidden" name="id" value={p.id} />
                      <button className="text-xs text-gray-400 hover:text-gray-600 hover:underline">unblock</button>
                    </form>
                  ) : (
                    <form action={blockCompany}>
                      <input type="hidden" name="id" value={p.id} />
                      <button
                        className="text-xs text-red-400 hover:text-red-600 hover:underline"
                        title="Never email this company again (wrong vertical / junk record)"
                      >
                        block
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">
                  {q
                    ? `No company matches “${q}”.`
                    : "Profiles appear as campaigns send (and backfill from past sends)."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
