import { getDefaultCompany } from "@/lib/db/queries";
import { MarketingShell, CtaButton, type Brand } from "@/components/MarketingShell";

// Commercial journey: professional, credibility-first. CTA is "request a
// proposal" / "schedule a walkthrough" — a considered B2B decision, not impulse.
export const dynamic = "force-dynamic";

export default async function Commercial() {
  const co = await getDefaultCompany();
  const brand: Brand = {
    name: co?.name ?? "Greenkeep",
    accent: co?.brand_color || "#2f7d4f",
    phone: co?.phone ?? null,
    email: co?.email ?? null,
  };
  const { name, accent } = brand;

  return (
    <MarketingShell brand={brand} active="commercial">
      <section className="px-6 py-16" style={{ backgroundColor: `${accent}0d` }}>
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
            {name} Commercial
          </span>
          <h1 className="mt-2 text-4xl font-bold">Grounds maintenance your tenants and owners notice.</h1>
          <p className="mt-4 text-lg text-gray-600">
            Route-managed crews, insured and COI-ready, with itemized proposals built from precise
            property measurements — so the scope and price are clear before you ever sign.
          </p>
          <div className="mt-7 flex justify-center gap-3">
            <CtaButton href="#contact" accent={accent}>Request a proposal</CtaButton>
            <a
              href={co?.booking_url || "#contact"}
              className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Schedule a walkthrough
            </a>
          </div>
        </div>
      </section>

      {/* Why us — B2B credibility */}
      <section className="mx-auto max-w-5xl px-6 py-14">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Value accent={accent} title="Consistent crews" body="Route-based scheduling means the same reliable service every visit — not a rotating cast." />
          <Value accent={accent} title="Insured & COI-ready" body="General liability coverage and certificates on file before we start." />
          <Value accent={accent} title="Audit-ready proposals" body="Scope and pricing built from measured turf, beds & hardscape — no vague estimates." />
          <Value accent={accent} title="One point of contact" body="A single account owner for every property in your portfolio." />
        </div>
      </section>

      {/* Property types served */}
      <section className="bg-gray-50 px-6 py-14">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-2xl font-semibold">Built for commercial portfolios</h2>
          <p className="mt-2 text-gray-600">Office parks · retail centers · self-storage · medical · churches · schools · industrial</p>
          <div className="mt-8 grid gap-6 text-left sm:grid-cols-2">
            <Card accent={accent} title="Full-service grounds" points={["Mowing, trimming & edging", "Bed & shrub maintenance", "Tree-ring & canopy care", "Seasonal cleanups"]} />
            <Card accent={accent} title="Account management" points={["Itemized, online proposals", "COI & insurance documentation", "Multi-site scheduling", "Responsive single point of contact"]} />
          </div>
          <div className="mt-8">
            <CtaButton href="#contact" accent={accent}>Request a proposal</CtaButton>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

function Value({ accent, title, body }: { accent: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-gray-200 p-5">
      <h3 className="font-semibold" style={{ color: accent }}>{title}</h3>
      <p className="mt-2 text-sm text-gray-600">{body}</p>
    </div>
  );
}

function Card({ accent, title, points }: { accent: string; title: string; points: string[] }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6">
      <h3 className="font-semibold" style={{ color: accent }}>{title}</h3>
      <ul className="mt-3 space-y-1.5 text-sm text-gray-700">
        {points.map((p) => (
          <li key={p} className="flex gap-2"><span style={{ color: accent }}>✓</span><span>{p}</span></li>
        ))}
      </ul>
    </div>
  );
}
