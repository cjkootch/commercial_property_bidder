import Link from "next/link";
import { getDefaultCompany } from "@/lib/db/queries";

// Public marketing homepage (Greenkeep). The operator estimator lives behind
// /login; customers sign in via /customer/login. No operator chrome here.
export const dynamic = "force-dynamic";

export default async function Home() {
  const co = await getDefaultCompany();
  const name = co?.name ?? "Greenkeep";
  const accent = co?.brand_color || "#2f7d4f";

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Top bar */}
      <header className="border-b border-gray-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-xl font-semibold" style={{ color: accent }}>
            {name}
          </span>
          <nav className="flex items-center gap-5 text-sm">
            <a href="#services" className="text-gray-600 hover:text-gray-900">Services</a>
            <a href="#contact" className="text-gray-600 hover:text-gray-900">Contact</a>
            <Link href="/customer/login" className="font-medium" style={{ color: accent }}>
              Customer sign-in
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 py-20 text-center" style={{ backgroundColor: `${accent}0d` }}>
        <div className="mx-auto max-w-3xl">
          <h1 className="text-4xl font-bold sm:text-5xl">
            Dependable grounds maintenance, on a schedule you can trust.
          </h1>
          <p className="mt-5 text-lg text-gray-600">
            {name} keeps commercial and residential properties sharp year-round — mowing, edging,
            beds, and seasonal care, with clear pricing and a crew that shows up.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <a
              href="#contact"
              className="rounded-lg px-6 py-3 text-sm font-medium text-white"
              style={{ backgroundColor: accent }}
            >
              Get a free quote
            </a>
            <Link
              href="/customer/login"
              className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              View my proposal
            </Link>
          </div>
        </div>
      </section>

      {/* Segments */}
      <section id="services" className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-8 md:grid-cols-2">
          <SegmentCard
            accent={accent}
            title={`${name} Commercial`}
            blurb="Office parks, retail centers, storage, medical, churches, and schools. Crew-routed for consistency, with itemized scope and audit-ready measurements."
            points={["Turf, beds & tree care", "Edging, blowing & litter", "Seasonal cleanups", "COI & reliable scheduling"]}
          />
          <SegmentCard
            accent={accent}
            title={`${name} Residential`}
            blurb="Homeowners who want a tidy yard without the hassle. Simple recurring plans, friendly crews, no contracts to decode."
            points={["Weekly / bi-weekly mowing", "Trimming & edging", "Bed weeding & mulch", "One-time cleanups"]}
          />
        </div>
      </section>

      {/* Contact / CTA */}
      <section id="contact" className="border-t border-gray-100 bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold">Get a free, no-pressure quote</h2>
          <p className="mt-2 text-gray-600">
            Tell us about your property and we&apos;ll send a detailed proposal you can review online.
          </p>
          <div className="mt-6 text-sm text-gray-700">
            {co?.phone ? <div>{co.phone}</div> : null}
            {co?.email ? (
              <a href={`mailto:${co.email}`} className="font-medium" style={{ color: accent }}>
                {co.email}
              </a>
            ) : null}
          </div>
        </div>
      </section>

      <footer className="px-6 py-8 text-center text-xs text-gray-400">
        © {name}. ·{" "}
        <Link href="/login" className="hover:text-gray-600">Operator login</Link>
      </footer>
    </div>
  );
}

function SegmentCard({
  accent,
  title,
  blurb,
  points,
}: {
  accent: string;
  title: string;
  blurb: string;
  points: string[];
}) {
  return (
    <div className="rounded-2xl border border-gray-200 p-7">
      <h3 className="text-xl font-semibold" style={{ color: accent }}>{title}</h3>
      <p className="mt-2 text-gray-600">{blurb}</p>
      <ul className="mt-4 space-y-1.5 text-sm text-gray-700">
        {points.map((p) => (
          <li key={p} className="flex gap-2">
            <span style={{ color: accent }}>✓</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
