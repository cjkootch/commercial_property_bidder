import Link from "next/link";
import { getDefaultCompany } from "@/lib/db/queries";
import { MarketingShell, type Brand } from "@/components/MarketingShell";
import { BrandStripes } from "@/components/BrandStripes";
import { InstantQuote } from "@/components/InstantQuote";

// Public homepage: a clear audience fork. Two distinct journeys — homeowners go
// to /residential, businesses/property managers go to /commercial — each with
// its own tailored landing page, messaging, and CTA.
export const dynamic = "force-dynamic";

export default async function Home() {
  const co = await getDefaultCompany();
  const brand: Brand = {
    name: co?.name ?? "Greenkeep",
    accent: co?.brand_color || "#2f7d4f",
    phone: co?.phone ?? null,
    email: co?.email ?? null,
  };
  const { name, accent } = brand;

  return (
    <MarketingShell brand={brand}>
      {/* Hero */}
      <section className="relative px-6 pt-16 pb-8 text-center" style={{ backgroundColor: `${accent}0d` }}>
        <BrandStripes accent={accent} />
        <div className="relative mx-auto max-w-3xl">
          <h1 className="text-4xl font-bold sm:text-5xl">
            Grounds maintenance you never have to think about.
          </h1>
          <p className="mt-5 text-lg text-gray-600">
            {name} keeps properties sharp year-round with dependable crews and clear pricing.
            Tell us which one you are — we&apos;ll take it from there.
          </p>
          <div className="mx-auto mt-8 max-w-md">
            <InstantQuote accent={accent} />
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Free instant estimate from satellite imagery — no phone call required.
          </p>
        </div>
      </section>

      {/* The fork: two distinct journeys */}
      <section className="mx-auto max-w-5xl px-6 pb-20 pt-6">
        <div className="grid gap-6 md:grid-cols-2">
          <JourneyCard
            accent={accent}
            href="/residential"
            eyebrow="For homeowners"
            title="Residential"
            blurb="A tidy yard without the hassle — simple recurring plans, friendly local crews, no contracts to decode."
            cta="I own a home →"
          />
          <JourneyCard
            accent={accent}
            href="/commercial"
            eyebrow="For businesses & property managers"
            title="Commercial"
            blurb="Consistent, route-managed service for office parks, retail, storage, medical, churches & schools — with insured crews and audit-ready proposals."
            cta="I manage a property →"
          />
        </div>
        <p className="mt-6 text-center text-sm text-gray-500">
          Already have a proposal?{" "}
          <Link href="/customer/login" className="font-medium" style={{ color: accent }}>
            Sign in to review &amp; accept it
          </Link>
          .
        </p>
      </section>
    </MarketingShell>
  );
}

function JourneyCard({
  accent,
  href,
  eyebrow,
  title,
  blurb,
  cta,
}: {
  accent: string;
  href: string;
  eyebrow: string;
  title: string;
  blurb: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-2xl border border-gray-200 p-8 transition hover:border-transparent hover:shadow-lg"
    >
      <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{eyebrow}</span>
      <h2 className="mt-1 text-2xl font-semibold" style={{ color: accent }}>{title}</h2>
      <p className="mt-3 flex-1 text-gray-600">{blurb}</p>
      <span className="mt-6 text-sm font-semibold" style={{ color: accent }}>{cta}</span>
    </Link>
  );
}
