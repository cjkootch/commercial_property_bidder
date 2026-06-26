import Link from "next/link";
import { getDefaultCompany } from "@/lib/db/queries";
import { MarketingShell, type Brand } from "@/components/MarketingShell";
import { BrandStripes } from "@/components/BrandStripes";
import { InstantQuote } from "@/components/InstantQuote";

// Homepage modeled on proven instant-quote landing-page structure (à la
// LawnStarter): address-first hero CTA → how it works → why us → services →
// audience fork → FAQ → repeated CTA. Trust signals are honest (no fabricated
// ratings/press); real reviews drop into the marked slot as they're earned.
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
      {/* Hero — address-first instant quote */}
      <section id="estimate" className="relative px-6 pt-16 pb-10" style={{ backgroundColor: `${accent}0d` }}>
        <BrandStripes accent={accent} />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
          <div>
            <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
              See your lawn-care price in seconds.
            </h1>
            <p className="mt-4 text-lg text-gray-600">
              {name} keeps homes and commercial properties sharp year-round. Enter your address for a
              free instant estimate — no phone call, no contracts.
            </p>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-700">
              {["Licensed & insured", "No long-term contracts", "Free instant estimate", "Satisfaction guarantee"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <span style={{ color: accent }}>✓</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="mx-auto w-full max-w-md">
            <InstantQuote accent={accent} />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-center text-2xl font-semibold">How it works</h2>
        <div className="mt-10 grid gap-8 sm:grid-cols-3">
          <Step n={1} accent={accent} title="Enter your address" body="We measure your property from current aerial imagery and show your estimate in seconds." />
          <Step n={2} accent={accent} title="See your price & book" body="Review your estimate online and grab a walkthrough time that fits your schedule." />
          <Step n={3} accent={accent} title="Relax — we handle it" body="Insured local crews keep your grounds sharp on a schedule you can count on." />
        </div>
      </section>

      {/* Why us */}
      <section className="bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-semibold">Why {name}</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Value accent={accent} title="No contracts" body="Skip, reschedule, or cancel anytime. We earn the next visit." />
            <Value accent={accent} title="Licensed & insured" body="General liability coverage, with COI provided on request." />
            <Value accent={accent} title="Transparent pricing" body="Quotes built from measured turf & beds — not vague guesses." />
            <Value accent={accent} title="Local crews" body="Dependable, vetted crews who treat your property like the neighbors are watching." />
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-center text-2xl font-semibold">Everything to keep it sharp</h2>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[
            "Mowing & trimming",
            "Edging & blowing",
            "Bed weeding & mulch",
            "Shrub & hedge trimming",
            "Seasonal cleanups",
            "Commercial grounds",
          ].map((svc) => (
            <div key={svc} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700">
              <span style={{ color: accent }}>✓</span> {svc}
            </div>
          ))}
        </div>
      </section>

      {/* Audience fork — our edge over residential-only competitors */}
      <section className="bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-semibold">Homes and businesses, handled</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <JourneyCard accent={accent} href="/residential" eyebrow="For homeowners" title="Residential" blurb="Simple recurring plans, friendly local crews, no contracts to decode." cta="Explore residential →" />
            <JourneyCard accent={accent} href="/commercial" eyebrow="For businesses & property managers" title="Commercial" blurb="Route-managed service for office parks, retail, storage, medical, churches & schools — insured, with audit-ready proposals." cta="Explore commercial →" />
          </div>
        </div>
      </section>

      {/* Reviews — honest placeholder; swap in real testimonials as earned */}
      <section className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h2 className="text-2xl font-semibold">Building a reputation, one property at a time</h2>
        <p className="mt-3 text-gray-600">
          We&apos;re a growing local company — every job is backed by our satisfaction guarantee: if it&apos;s
          not right, we make it right. Real customer reviews will live here as we earn them.
        </p>
      </section>

      {/* FAQ */}
      <section className="bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-2xl font-semibold">Questions, answered</h2>
          <div className="mt-8 space-y-5">
            <Faq q="How does the instant estimate work?" a="We locate your property, measure the lawn and beds from current aerial imagery, and apply our standard pricing — all in a few seconds." />
            <Faq q="Is the instant price exact?" a="It's a close estimate. We confirm the exact price at a quick, free walkthrough so there are no surprises either way." />
            <Faq q="Are there contracts?" a="No long-term contracts. Skip, reschedule, or cancel anytime." />
            <Faq q="Are you insured?" a="Yes — we carry general liability coverage and provide a certificate of insurance on request, which matters for commercial properties." />
          </div>
        </div>
      </section>

      {/* Repeated CTA */}
      <section className="px-6 py-16 text-center" style={{ backgroundColor: `${accent}0d` }}>
        <h2 className="text-2xl font-semibold">Ready for a sharper property?</h2>
        <p className="mt-2 text-gray-600">Get your free instant estimate in seconds.</p>
        <a href="#estimate" className="mt-6 inline-block rounded-lg px-6 py-3 text-sm font-semibold text-white" style={{ backgroundColor: accent }}>
          See my price →
        </a>
      </section>
    </MarketingShell>
  );
}

function Step({ n, accent, title, body }: { n: number; accent: string; title: string; body: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full text-base font-semibold text-white" style={{ backgroundColor: accent }}>
        {n}
      </div>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-gray-600">{body}</p>
    </div>
  );
}

function Value({ accent, title, body }: { accent: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="font-semibold" style={{ color: accent }}>{title}</h3>
      <p className="mt-2 text-sm text-gray-600">{body}</p>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="font-medium text-gray-900">{q}</h3>
      <p className="mt-1 text-sm text-gray-600">{a}</p>
    </div>
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
    <Link href={href} className="group flex flex-col rounded-2xl border border-gray-200 bg-white p-8 transition hover:border-transparent hover:shadow-lg">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{eyebrow}</span>
      <h3 className="mt-1 text-2xl font-semibold" style={{ color: accent }}>{title}</h3>
      <p className="mt-3 flex-1 text-gray-600">{blurb}</p>
      <span className="mt-6 text-sm font-semibold" style={{ color: accent }}>{cta}</span>
    </Link>
  );
}
