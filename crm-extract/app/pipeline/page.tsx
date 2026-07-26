// Pipeline board — columns from `pipeline_stage` rows, not a hardcoded enum.
//
// NET-NEW: the source app had no board of any kind, and its three parallel
// pipelines were all pgEnums, so adding a step meant a migration. Here the firm
// edits stage rows and the board reshapes itself.
//
// NO DRAG AND DROP, on purpose: this is a server component and each card carries a
// tiny "move" form, so the board works with zero client JavaScript. Dragging is a
// later enhancement (it needs a client component + an optimistic update); the
// requirement is a working pipeline view, and this is the version that cannot
// break. Noted in PACKET.md.
//
// The `nurture` column is deliberately rendered like any other stage but styled
// distinctly: in origination the nurture pool is not a dead-end, it is the
// inventory. Its cards show the revisit date, because that is the only thing that
// gets a nurtured deal moving again.
//
// Place at app/pipeline/page.tsx.

import Link from "next/link";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { brand, company, crmUser, deal, pipelineStage } from "../../db/schema";
import { todayInTz } from "../../crm/revisit";
import { moveDealAction } from "./actions";

export const dynamic = "force-dynamic";

const TZ = process.env.CRM_TIMEZONE || "America/New_York";

const COLUMN_STYLE: Record<string, string> = {
  open: "border-t-blue-400",
  nurture: "border-t-amber-400",
  won: "border-t-green-500",
  lost: "border-t-gray-300",
};

export default async function PipelinePage({
  searchParams,
}: {
  searchParams?: { brand?: string };
}) {
  const today = todayInTz(TZ);
  const brandFilter = searchParams?.brand;

  const [stages, brands, rows] = await Promise.all([
    db
      .select()
      .from(pipelineStage)
      .where(isNull(pipelineStage.archived_at))
      .orderBy(asc(pipelineStage.sort_order), asc(pipelineStage.label)),
    db.select({ id: brand.id, name: brand.name }).from(brand).orderBy(brand.name),
    db
      .select({
        d: deal,
        companyName: company.name,
        ownerName: crmUser.name,
        brandName: brand.name,
      })
      .from(deal)
      .innerJoin(company, eq(deal.company_id, company.id))
      .leftJoin(crmUser, eq(deal.owner_user_id, crmUser.id))
      .leftJoin(brand, eq(deal.brand_id, brand.id))
      .where(
        brandFilter
          ? sql`${deal.brand_id} = ${brandFilter} and ${company.blocked_at} is null`
          : isNull(company.blocked_at)
      )
      .orderBy(sql`${deal.revisit_date} asc nulls last`, asc(deal.updated_at)),
  ]);

  const byStage = new Map<string, typeof rows>();
  for (const r of rows) {
    byStage.set(r.d.stage_id, [...(byStage.get(r.d.stage_id) ?? []), r]);
  }
  const totalOf = (list: typeof rows) =>
    list.reduce((sum, r) => sum + (r.d.value_cents ?? 0), 0) / 100;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Pipeline</h1>
          <p className="mt-1 text-sm text-gray-500">
            {rows.length} live deal{rows.length === 1 ? "" : "s"} across {stages.length} stages
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link
            href="/pipeline"
            className={`rounded-full px-3 py-1.5 font-semibold ${
              !brandFilter ? "bg-gray-900 text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            Both brands
          </Link>
          {brands.map((b) => (
            <Link
              key={b.id}
              href={`/pipeline?brand=${b.id}`}
              className={`rounded-full px-3 py-1.5 font-semibold ${
                brandFilter === b.id
                  ? "bg-gray-900 text-white"
                  : "border border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {b.name}
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-5 flex gap-4 overflow-x-auto pb-4">
        {stages.map((s) => {
          const list = byStage.get(s.id) ?? [];
          return (
            <div
              key={s.id}
              className={`flex w-72 shrink-0 flex-col rounded-xl border border-gray-200 border-t-4 bg-gray-50 ${
                COLUMN_STYLE[s.kind] ?? "border-t-gray-300"
              }`}
            >
              <div className="px-3 py-2.5">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-sm font-bold text-gray-800">{s.label}</h2>
                  <span className="text-xs text-gray-400">{list.length}</span>
                </div>
                <p className="text-[11px] text-gray-400">
                  {totalOf(list) > 0 ? `$${totalOf(list).toLocaleString()}` : "—"}
                  {s.kind === "nurture" ? " · long fuse" : ""}
                </p>
              </div>

              <ul className="flex-1 space-y-2 px-2 pb-2">
                {list.map(({ d, companyName, ownerName, brandName }) => {
                  const due = !!d.revisit_date && d.revisit_date <= today;
                  return (
                    <li
                      key={d.id}
                      className={`rounded-lg border bg-white p-2.5 shadow-sm ${
                        due ? "border-amber-300" : "border-gray-200"
                      }`}
                    >
                      <Link
                        href={`/companies/${d.company_id}`}
                        className="text-sm font-medium text-gray-900 hover:underline"
                      >
                        {companyName}
                      </Link>
                      <p className="text-xs text-gray-500">{d.title}</p>
                      <p className="mt-1 text-[11px] text-gray-400">
                        {d.value_cents != null ? `$${(d.value_cents / 100).toLocaleString()}` : "no value"}
                        {ownerName ? ` · ${ownerName}` : ""}
                        {brandName && !brandFilter ? ` · ${brandName}` : ""}
                      </p>
                      {d.revisit_date ? (
                        <p
                          className={`mt-1 text-[11px] font-semibold ${
                            due ? "text-amber-800" : "text-gray-400"
                          }`}
                        >
                          revisit {d.revisit_date}
                          {due ? " · DUE" : ""}
                        </p>
                      ) : null}

                      {/* Stage move without client JS. */}
                      <form action={moveDealAction} className="mt-2 flex gap-1">
                        <input type="hidden" name="dealId" value={d.id} />
                        <select
                          name="stageId"
                          defaultValue={d.stage_id}
                          className="min-w-0 flex-1 rounded border border-gray-300 px-1.5 py-1 text-[11px]"
                        >
                          {stages.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <button className="rounded border border-gray-300 px-1.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50">
                          Move
                        </button>
                      </form>
                    </li>
                  );
                })}
                {list.length === 0 ? (
                  <li className="px-1 py-6 text-center text-xs text-gray-400">Empty</li>
                ) : null}
              </ul>
            </div>
          );
        })}
        {stages.length === 0 ? (
          <p className="text-sm text-gray-400">
            No stages defined yet — seed `pipeline_stage` (see db/seed.ts).
          </p>
        ) : null}
      </div>
    </div>
  );
}
