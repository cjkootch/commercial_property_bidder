import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, buyerOutreach, leadUnlock, property, prospectCompany } from "@/lib/db/schema";
import { displayName, leadKind } from "@/lib/leads/market";
import { asTrade, TRADES, tradeValueInput } from "@/lib/leads/trades";

// Per-blast drill-down: the property + its campaign trade and value estimate,
// who claimed it (name, kind, price), every company's Resend funnel state
// (sent → delivered → opened → clicked, or bounced) with the exact email each
// received, and the no-email companies queued for manual paste outreach.
export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d
    ? d.toLocaleString("en-US", {
        timeZone: "America/Chicago", month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

export default async function ProspectingBlastPage({
  params,
  searchParams,
}: {
  params: { propertyId: string };
  searchParams: { trade?: string };
}) {
  const [prop] = await db
    .select()
    .from(property)
    .where(eq(property.id, params.propertyId))
    .limit(1);

  const rows = await db
    .select()
    .from(buyerOutreach)
    .where(eq(buyerOutreach.property_id, params.propertyId))
    .orderBy(desc(buyerOutreach.sent_at), desc(buyerOutreach.created_at));

  // The campaign's trade: from the list link (?trade=), else the claim links.
  const trade = asTrade(
    searchParams.trade ??
      rows.find((r) => r.claim_url)?.claim_url?.match(/[?&]trade=([a-z]+)/)?.[1]
  );
  // A property can be campaigned to several trades — scope rows to this one.
  const tradeRows = rows.filter(
    (r) => asTrade(r.claim_url?.match(/[?&]trade=([a-z]+)/)?.[1]) === trade
  );

  const emailed = tradeRows.filter((r) => r.status === "sent" || r.status === "bounced");
  const manual = tradeRows.filter((r) => r.status === "skipped");

  // Company-graph profile ids so each name drills into the full journey.
  const keys = [...new Set(tradeRows.map((r) => r.company_key))];
  const profiles = keys.length
    ? await db
        .select({ id: prospectCompany.id, key: prospectCompany.key })
        .from(prospectCompany)
        .where(inArray(prospectCompany.key, keys))
    : [];
  const profileByKey = new Map(profiles.map((p) => [p.key, p.id]));
  const kind = prop ? leadKind(prop.name) : null;
  const est = prop && kind ? TRADES[trade].estimateValue(tradeValueInput(prop, kind)) : null;
  const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

  // Who claimed it — every unlock on the property, any trade, with the buyer.
  const claims = prop
    ? await db
        .select({
          kind: leadUnlock.kind,
          trade: leadUnlock.trade,
          price_cents: leadUnlock.price_cents,
          at: leadUnlock.created_at,
          company: buyer.company_name,
          email: buyer.email,
        })
        .from(leadUnlock)
        .innerJoin(buyer, eq(leadUnlock.buyer_id, buyer.id))
        .where(eq(leadUnlock.property_id, prop.id))
        .orderBy(desc(leadUnlock.created_at))
    : [];

  return (
    <div>
      <Link href="/campaigns" className="text-sm text-gray-400 hover:text-gray-600">
        ← Campaigns
      </Link>
      <h1 className="mt-2 flex flex-wrap items-center gap-2 text-2xl font-semibold">
        {prop ? displayName(prop.name) : "Lead-offer blast"}
        <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-bold text-brand">
          {TRADES[trade].label}
        </span>
      </h1>
      <p className="mt-1 text-sm text-gray-500">
        {prop?.address ? `${prop.address}, ` : ""}
        {prop?.city ?? ""}
        {est ? ` · est. ${usd(est.annualLo)}–${usd(est.annualHi)}${est.per === "project" ? " project" : "/yr"} (${est.basis})` : ""}
        {" · "}
        {emailed.length} emailed · {manual.length} without an email
        {prop ? (
          <>
            {" · "}
            <Link href={`/properties/${prop.id}`} className="text-brand hover:underline">
              view lead
            </Link>
          </>
        ) : null}
      </p>

      {claims.length ? (
        <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
          <h2 className="text-sm font-bold text-green-900">
            Claimed by {claims.length} compan{claims.length === 1 ? "y" : "ies"}
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-green-900">
            {claims.map((c, i) => (
              <li key={i}>
                <span className="font-semibold">{c.company}</span>{" "}
                <span className="text-green-700">({c.email})</span> —{" "}
                {c.kind === "free"
                  ? "free claim"
                  : c.kind === "exclusive"
                    ? `EXCLUSIVE, ${usd(c.price_cents / 100)}`
                    : `paid, ${usd(c.price_cents / 100)}`}{" "}
                · {c.trade} · {fmt(c.at)}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-400">No claims yet — spots are still open.</p>
      )}

      <div className="mt-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2.5 font-medium">Company</th>
              <th className="px-3 py-2.5 font-medium">Email</th>
              <th className="px-3 py-2.5 font-medium">Sent</th>
              <th className="px-3 py-2.5 font-medium">Delivered</th>
              <th className="px-3 py-2.5 font-medium">Opened</th>
              <th className="px-3 py-2.5 font-medium">Clicked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {emailed.map((r) => (
              <tr key={r.id} className={r.status === "bounced" ? "bg-red-50/50" : "hover:bg-gray-50"}>
                <td className="px-4 py-3">
                  {profileByKey.has(r.company_key) ? (
                    <Link
                      href={`/companies/${profileByKey.get(r.company_key)}`}
                      className="font-medium text-gray-900 hover:text-brand hover:underline"
                    >
                      {r.company_name}
                    </Link>
                  ) : (
                    <div className="font-medium text-gray-900">{r.company_name}</div>
                  )}
                  <div className="text-xs text-gray-400">
                    {r.office_city ?? ""}
                    {r.distance_mi != null ? ` · ${Math.round(r.distance_mi)} mi` : ""}
                    {r.commercial_signal ? " · commercial" : ""}
                  </div>
                  {r.message ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-brand hover:underline">
                        view email
                      </summary>
                      <pre className="mt-2 max-w-xl whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
                        {r.message}
                      </pre>
                    </details>
                  ) : null}
                </td>
                <td className="px-3 py-3 text-gray-600">{r.email}</td>
                <td className="px-3 py-3 text-gray-500">
                  {r.status === "bounced" ? (
                    <span className="font-medium text-red-600">Bounced</span>
                  ) : (
                    fmt(r.sent_at) ?? "—"
                  )}
                </td>
                <td className="px-3 py-3 text-gray-500">{fmt(r.delivered_at) ?? "—"}</td>
                <td className="px-3 py-3">
                  {r.opened_at ? (
                    <span className="text-green-700">
                      {fmt(r.opened_at)}
                      {r.open_count > 1 ? ` ×${r.open_count}` : ""}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  {r.clicked_at ? (
                    <span className="font-medium text-green-700">
                      {fmt(r.clicked_at)}
                      {r.click_count > 1 ? ` ×${r.click_count}` : ""}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
              </tr>
            ))}
            {emailed.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                  Nothing emailed for this lead yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {manual.length > 0 ? (
        <div className="mt-8">
          <h2 className="text-lg font-semibold">No email found — manual outreach</h2>
          <p className="mt-1 text-sm text-gray-500">
            Real companies we qualified but couldn&apos;t email. Paste the saved message into
            their contact form or call.
          </p>
          <div className="mt-3 divide-y divide-gray-50 rounded-xl border border-gray-200 bg-white">
            {manual.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  {profileByKey.has(r.company_key) ? (
                    <Link
                      href={`/companies/${profileByKey.get(r.company_key)}`}
                      className="font-medium text-gray-900 hover:text-brand hover:underline"
                    >
                      {r.company_name}
                    </Link>
                  ) : (
                    <div className="font-medium text-gray-900">{r.company_name}</div>
                  )}
                  <div className="text-xs text-gray-400">
                    {r.office_city ?? ""}
                    {r.phone ? ` · ${r.phone}` : ""}
                  </div>
                </div>
                <div className="flex gap-3 text-xs">
                  {r.contact_form_url ? (
                    <a
                      href={r.contact_form_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand hover:underline"
                    >
                      Contact form ↗
                    </a>
                  ) : null}
                  {r.website ? (
                    <a
                      href={r.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-gray-500 hover:underline"
                    >
                      Website ↗
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
