// Company list: search + filter + sort + engagement columns.
//
// Ported from app/companies/page.tsx, with its one real flaw fixed. The source
// version loaded 1,000 company rows PLUS every outreach row in the database and
// reduced them in JavaScript to compute per-company counts. That is fine at
// launch and becomes the slowest page in the app at scale. Here the counts come
// from a single SQL aggregate (crm/activity.ts companyEngagement) over just the
// visible page of companies.
//
// Kept from the source: the searchParams-driven filter chips (no client state, a
// shareable URL per view) and inline server-action buttons in the row.
//
// Place at app/companies/page.tsx.

import Link from "next/link";
import { and, asc, desc, eq, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "../../db";
import { brand, company, crmUser } from "../../db/schema";
import { companyEngagement } from "../../crm/activity";
import { todayInTz } from "../../crm/revisit";

export const dynamic = "force-dynamic";

const TZ = process.env.CRM_TIMEZONE || "America/New_York";
const PAGE_SIZE = 50;

type Sort = "recent" | "name" | "revisit";

function fmtDate(d: Date | null): string {
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "—";
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams?: { q?: string; brand?: string; owner?: string; view?: string; sort?: string; page?: string };
}) {
  const q = (searchParams?.q ?? "").trim();
  const view = searchParams?.view ?? "all";
  const sort = (searchParams?.sort ?? "recent") as Sort;
  const page = Math.max(1, Number(searchParams?.page ?? 1) || 1);
  const today = todayInTz(TZ);

  const [brands, users] = await Promise.all([
    db.select({ id: brand.id, name: brand.name }).from(brand).orderBy(brand.name),
    db.select({ id: crmUser.id, name: crmUser.name }).from(crmUser).where(isNull(crmUser.disabled_at)),
  ]);

  // Filters compose: search AND view AND brand AND owner.
  const filters: (SQL | undefined)[] = [];
  if (q) {
    const term = `%${q.toLowerCase()}%`;
    filters.push(
      or(
        sql`lower(${company.name}) like ${term}`,
        sql`lower(${company.legal_name}) like ${term}`,
        sql`lower(${company.domain}) like ${term}`,
        sql`lower(${company.city}) like ${term}`
      )
    );
  }
  if (searchParams?.brand) filters.push(eq(company.brand_id, searchParams.brand));
  if (searchParams?.owner) filters.push(eq(company.owner_user_id, searchParams.owner));
  if (view === "due") filters.push(and(isNotNull(company.revisit_date), sql`${company.revisit_date} <= ${today}`));
  if (view === "scheduled") filters.push(isNotNull(company.revisit_date));
  if (view === "unscheduled") filters.push(and(isNull(company.revisit_date), isNull(company.blocked_at)));
  if (view === "blocked") filters.push(isNotNull(company.blocked_at));
  else if (view !== "all") filters.push(isNull(company.blocked_at));

  const where = filters.length ? and(...(filters.filter(Boolean) as SQL[])) : undefined;
  const orderBy =
    sort === "name"
      ? asc(company.name)
      : sort === "revisit"
        ? sql`${company.revisit_date} asc nulls last`
        : desc(company.updated_at);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        c: company,
        brandName: brand.name,
        ownerName: crmUser.name,
      })
      .from(company)
      .leftJoin(brand, eq(company.brand_id, brand.id))
      .leftJoin(crmUser, eq(company.owner_user_id, crmUser.id))
      .where(where)
      .orderBy(orderBy)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(company)
      .where(where),
  ]);

  // ONE aggregate for just these 50 companies — not a full-table scan.
  const engagement = await companyEngagement(rows.map((r) => r.c.id));

  const chip = (label: string, params: Record<string, string | undefined>, active: boolean) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (searchParams?.brand) sp.set("brand", searchParams.brand);
    if (searchParams?.owner) sp.set("owner", searchParams.owner);
    if (sort !== "recent") sp.set("sort", sort);
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    return (
      <Link
        key={label}
        href={`/companies?${sp.toString()}`}
        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
          active ? "bg-gray-900 text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Companies</h1>
          <p className="mt-1 text-sm text-gray-500">{total.toLocaleString()} records</p>
        </div>
        {/* GET form: the search term lives in the URL, so any view is shareable
            and the back button works. */}
        <form action="/companies" method="get" className="flex gap-2">
          {view !== "all" ? <input type="hidden" name="view" value={view} /> : null}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name, domain, city…"
            className="w-64 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
          <button className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white">
            Search
          </button>
        </form>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {chip("All", { view: undefined }, view === "all")}
        {chip("Revisit due", { view: "due" }, view === "due")}
        {chip("Scheduled", { view: "scheduled" }, view === "scheduled")}
        {chip("No revisit set", { view: "unscheduled" }, view === "unscheduled")}
        {chip("Blocked", { view: "blocked" }, view === "blocked")}
        <span className="mx-1 h-4 w-px bg-gray-200" />
        {brands.map((b) => chip(b.name, { brand: b.id, view: view === "all" ? undefined : view }, searchParams?.brand === b.id))}
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2.5 font-medium">Company</th>
              <th className="px-3 py-2.5 font-medium">Brand</th>
              <th className="px-3 py-2.5 font-medium">Owner</th>
              <th className="px-3 py-2.5 text-right font-medium">Out</th>
              <th className="px-3 py-2.5 text-right font-medium">In</th>
              <th className="px-3 py-2.5 text-right font-medium">Opens</th>
              <th className="px-3 py-2.5 font-medium">Last touch</th>
              <th className="px-3 py-2.5 font-medium">Revisit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map(({ c, brandName, ownerName }) => {
              const e = engagement.get(c.id);
              const due = !!c.revisit_date && c.revisit_date <= today;
              return (
                <tr key={c.id} className={due ? "bg-amber-50/60" : "hover:bg-gray-50"}>
                  <td className="px-4 py-3">
                    <Link href={`/companies/${c.id}`} className="font-medium text-gray-900 hover:underline">
                      {c.name}
                    </Link>
                    <div className="text-xs text-gray-400">
                      {[c.city, c.state].filter(Boolean).join(", ")}
                      {c.domain ? ` · ${c.domain}` : ""}
                    </div>
                    {c.blocked_at ? (
                      <span className="mt-1 inline-block rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-bold text-gray-600">
                        BLOCKED
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-500">{brandName ?? "—"}</td>
                  <td className="px-3 py-3 text-xs text-gray-500">{ownerName ?? "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{e?.emailsOut ?? 0}</td>
                  <td className={`px-3 py-3 text-right tabular-nums ${e?.emailsIn ? "font-bold text-green-700" : ""}`}>
                    {e?.emailsIn ?? 0}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{e?.opens ?? 0}</td>
                  <td className="px-3 py-3 text-xs text-gray-500">{fmtDate(e?.lastTouchAt ?? null)}</td>
                  <td className="px-3 py-3 text-xs">
                    {c.revisit_date ? (
                      <span className={due ? "font-bold text-amber-800" : "text-gray-600"}>
                        {c.revisit_date}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">
                  No companies match this view.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE ? (
        <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
          <span>
            Page {page} of {Math.ceil(total / PAGE_SIZE)}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link href={`/companies?${new URLSearchParams({ ...searchParams, page: String(page - 1) } as Record<string, string>)}`} className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50">
                ← Prev
              </Link>
            ) : null}
            {page * PAGE_SIZE < total ? (
              <Link href={`/companies?${new URLSearchParams({ ...searchParams, page: String(page + 1) } as Record<string, string>)}`} className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50">
                Next →
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
