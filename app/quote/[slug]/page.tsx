import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getProspectBySlug, getDefaultCompany } from "@/lib/db/queries";
import { recordProspectView } from "@/app/buyers/prospects/actions";
import { DEFAULT_SCOPE_ITEMS } from "@/lib/proposals";
import type { DossierAerial } from "@/lib/leads/dossier";

// Public, link-shareable quote branded to the LANDSCAPER (not Greenkeep). The
// postcard's QR points here. Each load is recorded for open tracking. No auth
// (/quote is whitelisted in middleware). Renders even for archived prospects so
// a mailed card's QR keeps resolving.
export const dynamic = "force-dynamic";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default async function QuoteMicrosite({ params }: { params: { slug: string } }) {
  const data = await getProspectBySlug(params.slug);
  if (!data || !data.buyer) notFound();
  const { prospect: p, buyer: b } = data;

  // Best-effort open tracking (won't block render on failure).
  await recordProspectView(params.slug, headers().get("user-agent"));

  const co = await getDefaultCompany();
  const accent = co?.brand_color || "#2f7d4f";
  const aerial = p.aerial as DossierAerial | null;

  const monthly =
    p.price_override_cents != null ? p.price_override_cents / 100 : p.monthly_price ?? null;
  const annual = monthly != null ? monthly * 12 : null;
  const addr = [p.address, p.city, p.zip].filter(Boolean).join(", ");
  const contactLine = [b.phone, b.email, b.website].filter(Boolean).join("  ·  ");

  return (
    <div className="min-h-screen bg-gray-100 py-10">
      <div className="mx-auto max-w-2xl px-6">
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {/* Branded header — the landscaping company */}
          <div className="px-8 py-6 text-white" style={{ backgroundColor: accent }}>
            <div className="flex items-center gap-3">
              {b.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={b.logo_url}
                  alt={b.company_name}
                  className="h-10 w-10 rounded-md bg-white/20 object-contain p-1"
                />
              ) : null}
              <div>
                <div className="text-sm uppercase tracking-wide opacity-90">Grounds maintenance proposal</div>
                <h1 className="mt-0.5 text-2xl font-semibold">{b.company_name}</h1>
              </div>
            </div>
            {contactLine ? <div className="mt-2 text-sm opacity-90">{contactLine}</div> : null}
            {b.license_number ? (
              <div className="mt-0.5 text-xs opacity-80">License {b.license_number}</div>
            ) : null}
          </div>

          <div className="px-8 py-6">
            <div className="text-sm text-gray-500">Prepared for</div>
            <div className="text-lg font-medium text-gray-900">{p.name || addr || "Your property"}</div>
            {addr ? <div className="text-sm text-gray-600">{addr}</div> : null}

            {/* Aerial with measured grounds */}
            {aerial?.image ? (
              <figure className="mt-5 overflow-hidden rounded-xl border border-gray-200">
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={aerial.image} alt="Property from above" className="block w-full" />
                  {aerial.mask ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={aerial.mask}
                      alt=""
                      className="pointer-events-none absolute inset-0 h-full w-full opacity-70"
                    />
                  ) : null}
                  {aerial.outline?.length ? (
                    <svg
                      viewBox={`0 0 ${aerial.width} ${aerial.height}`}
                      preserveAspectRatio="none"
                      className="pointer-events-none absolute inset-0 h-full w-full"
                    >
                      {aerial.outline.map((pts, i) => (
                        <polygon
                          key={i}
                          points={pts}
                          fill="none"
                          stroke="#ffe14d"
                          strokeWidth={Math.max(2, aerial.width / 350)}
                          strokeDasharray={`${aerial.width / 90} ${aerial.width / 140}`}
                        />
                      ))}
                    </svg>
                  ) : null}
                </div>
                <figcaption className="bg-gray-50 px-4 py-2 text-xs text-gray-500">
                  {p.turf_sqft
                    ? `≈ ${Math.round(p.turf_sqft).toLocaleString()} sq ft of maintained turf, measured from current aerial imagery.`
                    : "Measured from current aerial imagery."}
                </figcaption>
              </figure>
            ) : null}

            {/* Estimate */}
            <div className="mt-6 rounded-xl border border-gray-200 p-5">
              <div className="font-medium text-gray-900">Full-service grounds maintenance</div>
              {monthly != null ? (
                <div className="mt-4 flex items-end gap-6">
                  <div>
                    <div className="text-3xl font-semibold" style={{ color: accent }}>
                      {usd(monthly)}
                    </div>
                    <div className="text-xs uppercase tracking-wide text-gray-500">per month</div>
                  </div>
                  {annual != null ? (
                    <div className="text-gray-400">
                      <div className="text-lg font-medium text-gray-700">{usd(annual)}</div>
                      <div className="text-xs uppercase tracking-wide">per year</div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-2 text-sm text-gray-500">Estimate in progress.</div>
              )}
              <p className="mt-3 text-xs text-gray-400">
                Estimate from aerial measurement — exact price confirmed with a free walkthrough.
              </p>
            </div>

            {/* Scope of work */}
            <div className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                Scope of work
              </h2>
              <ul className="mt-3 space-y-1.5 text-sm text-gray-700">
                {DEFAULT_SCOPE_ITEMS.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span style={{ color: accent }}>✓</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* CTA — contact the landscaper */}
            {b.phone ? (
              <a
                href={`tel:${b.phone.replace(/[^0-9+]/g, "")}`}
                className="mt-8 inline-block rounded-lg px-5 py-3 text-sm font-medium text-white"
                style={{ backgroundColor: accent }}
              >
                Call {b.company_name} — {b.phone}
              </a>
            ) : b.email ? (
              <a
                href={`mailto:${b.email}`}
                className="mt-8 inline-block rounded-lg px-5 py-3 text-sm font-medium text-white"
                style={{ backgroundColor: accent }}
              >
                Request a walkthrough
              </a>
            ) : null}

            <p className="mt-8 border-t border-gray-100 pt-4 text-xs text-gray-400">
              Prepared by {b.company_name}
              {b.address && b.city ? ` · ${b.address}, ${b.city}` : ""}.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
