import Link from "next/link";
import { desc, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { property } from "@/lib/db/schema";
import { buildLeadRows, type LeadTier } from "@/lib/leads/package";
import { usd } from "@/lib/format";

// Lead marketplace: package measured+priced properties as sellable leads.
// Compliance is enforced in lib/leads/package.ts — public-record data only,
// Apollo contacts excluded, inbound customer leads never sold, sold once.
export const dynamic = "force-dynamic";

const TIER_STYLE: Record<LeadTier, string> = {
  verified: "bg-green-100 text-green-800",
  "estimated+": "bg-blue-100 text-blue-800",
  estimated: "bg-gray-100 text-gray-600",
};

const TIER_HINT: Record<LeadTier, string> = {
  verified: "human-verified measurement",
  "estimated+": "ML measurement, passed confidence gate",
  estimated: "auto estimate, unreviewed",
};

export default async function LeadsPage() {
  const rows = await buildLeadRows("unexported");
  const exported = await db
    .select()
    .from(property)
    .where(isNotNull(property.lead_exported_at))
    .orderBy(desc(property.lead_exported_at))
    .limit(10);

  const tierCount = (t: LeadTier) => rows.filter((r) => r.tier === t).length;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold">Lead packages</h1>
      <p className="mt-1 text-sm text-gray-500">
        Measured, priced properties packaged for sale to landscapers in markets we don&apos;t serve.
      </p>
      <p className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
        Packages contain <strong>public-record data only</strong> (county owner-of-record, our
        measurements/pricing, OSM/website contacts). Apollo-enriched contacts are excluded
        automatically, inbound customer leads are never sold, and each lead is sold once.
      </p>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex gap-3 text-sm">
          {(Object.keys(TIER_STYLE) as LeadTier[]).map((t) => (
            <span key={t} className={`rounded-full px-3 py-1 font-medium ${TIER_STYLE[t]}`} title={TIER_HINT[t]}>
              {t}: {tierCount(t)}
            </span>
          ))}
        </div>
        <form action="/leads/export" method="GET" className="flex items-end gap-2">
          <label className="block text-sm">
            <span className="text-gray-600">Buyer (optional)</span>
            <input name="buyer" placeholder="e.g. GreenCo Dallas" className="input mt-1" />
          </label>
          <input type="hidden" name="scope" value="unexported" />
          <button
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            disabled={rows.length === 0}
          >
            Download CSV ({rows.length})
          </button>
        </form>
      </div>
      <p className="mt-1 text-right text-xs text-amber-700">
        Downloading marks these {rows.length} lead{rows.length === 1 ? "" : "s"} as exported — they
        leave the pool (sold once).
      </p>

      {rows.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          No unexported leads. The nightly pipeline grows the pool; label/verify measurements to
          upgrade tiers.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2.5">Property</th>
                <th className="px-4 py-2.5">Tier</th>
                <th className="px-4 py-2.5 text-right">Turf sf</th>
                <th className="px-4 py-2.5 text-right">Est. $/mo</th>
                <th className="px-4 py-2.5">Owner of record</th>
                <th className="px-4 py-2.5">Contact</th>
                <th className="px-4 py-2.5 text-right">Views</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.property_id}>
                  <td className="px-4 py-2.5">
                    <Link href={`/properties/${r.property_id}`} className="font-medium text-gray-900 hover:underline">
                      {r.name}
                    </Link>
                    <span className="ml-2 text-xs text-gray-400">
                      {[r.city, r.county && `${r.county} Co.`].filter(Boolean).join(" · ")}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TIER_STYLE[r.tier]}`} title={TIER_HINT[r.tier]}>
                      {r.tier}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.turf_sqft.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{usd(r.monthly_value, { cents: false })}</td>
                  <td className="px-4 py-2.5 text-gray-600">{r.owner_of_record ?? "—"}</td>
                  <td className="px-4 py-2.5 text-gray-600">{r.contact_email ?? r.contact_phone ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.proposal_views}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {exported.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-lg font-medium">Recently exported</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-gray-600">
            {exported.map((p) => (
              <li key={p.id} className="flex justify-between rounded-md border border-gray-100 bg-white px-3 py-2">
                <span>{p.name}</span>
                <span className="text-gray-400">
                  {p.lead_buyer ? `→ ${p.lead_buyer} · ` : ""}
                  {p.lead_exported_at?.toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
