import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyerOutreach, property } from "@/lib/db/schema";
import { displayName } from "@/lib/leads/market";

// Per-blast drill-down: every company we offered this lead to, with its Resend
// funnel state (sent → delivered → opened → clicked, or bounced) and the
// no-email companies queued for manual paste outreach.
export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d
    ? d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

export default async function ProspectingBlastPage({
  params,
}: {
  params: { propertyId: string };
}) {
  const [prop] = await db
    .select({ id: property.id, name: property.name, city: property.city })
    .from(property)
    .where(eq(property.id, params.propertyId))
    .limit(1);

  const rows = await db
    .select()
    .from(buyerOutreach)
    .where(eq(buyerOutreach.property_id, params.propertyId))
    .orderBy(desc(buyerOutreach.sent_at), desc(buyerOutreach.created_at));

  const emailed = rows.filter((r) => r.status === "sent" || r.status === "bounced");
  const manual = rows.filter((r) => r.status === "skipped");

  return (
    <div>
      <Link href="/campaigns" className="text-sm text-gray-400 hover:text-gray-600">
        ← Campaigns
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">
        {prop ? displayName(prop.name) : "Lead-offer blast"}
      </h1>
      <p className="mt-1 text-sm text-gray-500">
        {prop?.city ? `${prop.city} · ` : ""}
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
                  <div className="font-medium text-gray-900">{r.company_name}</div>
                  <div className="text-xs text-gray-400">
                    {r.office_city ?? ""}
                    {r.distance_mi != null ? ` · ${Math.round(r.distance_mi)} mi` : ""}
                    {r.commercial_signal ? " · commercial" : ""}
                  </div>
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
                  <div className="font-medium text-gray-900">{r.company_name}</div>
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
