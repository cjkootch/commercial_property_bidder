import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getProposalBySlug } from "@/lib/db/queries";
import { recordProposalView } from "@/app/properties/actions";
import type { FrequencyOption } from "@/lib/proposals";
import { usd } from "@/lib/format";

// Public, link-shareable quote. Renders LIVE data, so re-pricing or editing
// scope after the link is sent updates what the recipient sees. Each load is
// recorded for open tracking. No operator auth (whitelisted in middleware).
export const dynamic = "force-dynamic";

export default async function ProposalPage({ params }: { params: { slug: string } }) {
  const data = await getProposalBySlug(params.slug);
  if (!data || !data.property || !data.pricing) notFound();

  const { proposal: p, property: prop, pricing, company: co } = data;

  // Best-effort open tracking (won't block render on failure).
  const ua = headers().get("user-agent");
  await recordProposalView(params.slug, ua);

  const accent = co?.brand_color || "#2f7d4f";
  const options = (p.frequency_options as FrequencyOption[]) ?? [];
  const scope = (p.scope_items as string[]) ?? [];
  const addr = [prop.address, prop.city, prop.zip].filter(Boolean).join(", ");

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="mx-auto max-w-2xl px-6">
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {/* Branded header */}
          <div className="px-8 py-6 text-white" style={{ backgroundColor: accent }}>
            <div className="text-sm uppercase tracking-wide opacity-90">Service proposal</div>
            <h1 className="mt-1 text-2xl font-semibold">{co?.name ?? "Grounds Maintenance"}</h1>
            {co?.phone || co?.email ? (
              <div className="mt-1 text-sm opacity-90">
                {[co?.phone, co?.email].filter(Boolean).join("  ·  ")}
              </div>
            ) : null}
          </div>

          <div className="px-8 py-6">
            <div className="text-sm text-gray-500">Prepared for</div>
            <div className="text-lg font-medium text-gray-900">{prop.owner_org || prop.name}</div>
            <div className="text-sm text-gray-600">
              {prop.name}
              {addr ? ` · ${addr}` : ""}
            </div>

            {/* Pricing options */}
            <div className="mt-6 space-y-4">
              {options.map((o, i) => (
                <div key={i} className="rounded-xl border border-gray-200 p-5">
                  <div className="font-medium text-gray-900">{o.label}</div>
                  <div className="mt-1 text-sm text-gray-500">
                    {o.visits_per_year} visits/year · {usd(o.price_per_visit)}/visit
                  </div>
                  <div className="mt-4 flex items-end gap-6">
                    <div>
                      <div className="text-3xl font-semibold" style={{ color: accent }}>
                        {usd(o.monthly, { cents: false })}
                      </div>
                      <div className="text-xs uppercase tracking-wide text-gray-500">per month</div>
                    </div>
                    <div className="text-gray-400">
                      <div className="text-lg font-medium text-gray-700">
                        {usd(o.annual, { cents: false })}
                      </div>
                      <div className="text-xs uppercase tracking-wide">per year</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Scope of work */}
            {scope.length ? (
              <div className="mt-8">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                  Scope of work
                </h2>
                <ul className="mt-3 space-y-1.5 text-sm text-gray-700">
                  {scope.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span style={{ color: accent }}>✓</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* CTA */}
            {co?.booking_url ? (
              <a
                href={co.booking_url}
                className="mt-8 inline-block rounded-lg px-5 py-3 text-sm font-medium text-white"
                style={{ backgroundColor: accent }}
              >
                Schedule a walkthrough
              </a>
            ) : null}

            {co?.physical_mailing_address ? (
              <p className="mt-8 border-t border-gray-100 pt-4 text-xs text-gray-400">
                {co.name} · {co.physical_mailing_address}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
