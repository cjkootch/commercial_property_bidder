import { getDefaultCompany } from "@/lib/db/queries";
import { MarketingShell, CtaButton, type Brand } from "@/components/MarketingShell";

// Residential journey: warm, simple, low-friction. One primary CTA (get a quote).
export const dynamic = "force-dynamic";

export default async function Residential() {
  const co = await getDefaultCompany();
  const brand: Brand = {
    name: co?.name ?? "Greenkeep",
    accent: co?.brand_color || "#2f7d4f",
    phone: co?.phone ?? null,
    email: co?.email ?? null,
  };
  const { name, accent } = brand;

  return (
    <MarketingShell brand={brand} active="residential">
      <section className="px-6 py-16 text-center" style={{ backgroundColor: `${accent}0d` }}>
        <div className="mx-auto max-w-2xl">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
            {name} Residential
          </span>
          <h1 className="mt-2 text-4xl font-bold">A yard you&apos;re proud of — without lifting a finger.</h1>
          <p className="mt-4 text-lg text-gray-600">
            Friendly local crews, a schedule you can count on, and simple flat-rate plans. No
            long-term contracts, no surprises.
          </p>
          <div className="mt-7">
            <CtaButton href="/quote?type=residential" accent={accent}>Get my free quote</CtaButton>
          </div>
        </div>
      </section>

      {/* How it works — reduce friction with a clear 3 steps */}
      <section className="mx-auto max-w-4xl px-6 py-14">
        <h2 className="text-center text-2xl font-semibold">As easy as it should be</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          <Step n={1} accent={accent} title="Tell us your address" body="Send a quick note — we size up your yard from the property line." />
          <Step n={2} accent={accent} title="Get a flat quote" body="A simple weekly or bi-weekly price. Approve it online in a click." />
          <Step n={3} accent={accent} title="We show up" body="Your crew arrives on schedule and your yard stays sharp." />
        </div>
      </section>

      {/* Plans / services */}
      <section className="bg-gray-50 px-6 py-14">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-2xl font-semibold">What&apos;s included</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <Card accent={accent} title="Recurring mowing" points={["Weekly or bi-weekly", "Mow, string-trim & edge", "Clippings blown off hard surfaces"]} />
            <Card accent={accent} title="Yard care add-ons" points={["Bed weeding & fresh mulch", "Shrub & hedge trimming", "Spring / fall cleanups"]} />
          </div>
          <div className="mt-8 text-center">
            <CtaButton href="/quote?type=residential" accent={accent}>Get my free quote</CtaButton>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-2xl px-6 py-14 text-center">
        <p className="text-gray-600">
          Local, insured, and easy to reach. We treat your home like the neighbors are watching —
          because they are.
        </p>
      </section>
    </MarketingShell>
  );
}

function Step({ n, accent, title, body }: { n: number; accent: string; title: string; body: string }) {
  return (
    <div className="text-center">
      <div
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
        style={{ backgroundColor: accent }}
      >
        {n}
      </div>
      <h3 className="mt-3 font-medium">{title}</h3>
      <p className="mt-1 text-sm text-gray-600">{body}</p>
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
