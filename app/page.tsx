import Link from "next/link";
import { getDefaultCompany } from "@/lib/db/queries";
import { MarketingShell, type Brand } from "@/components/MarketingShell";
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
      {/* Hero — address-first instant quote beside the brand illustration */}
      <section id="estimate" className="px-6 pt-16 pb-12" style={{ backgroundColor: `${accent}0d` }}>
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
          <div>
            <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
              Your lawn-care price, in seconds.
            </h1>
            <p className="mt-4 max-w-xl text-lg text-gray-600">
              {name} keeps Houston-area homes, offices, and commercial grounds sharp year-round —
              get a free instant estimate online, no phone call required.
            </p>
            <div className="mt-8 max-w-xl">
              <InstantQuote accent={accent} />
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-700">
              {["Licensed & insured", "No long-term contracts", "Free instant estimate", "Satisfaction guarantee"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <span style={{ color: accent }}>✓</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/hero.webp"
            alt={`${name} crew servicing a commercial property and a home`}
            width={1600}
            height={960}
            className="hidden h-auto w-full lg:block"
          />
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-center text-2xl font-semibold">How it works</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-gray-600">
          Get a real estimate online in seconds — no phone call, no salesperson.
        </p>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          <Step n={1} accent={accent} title="Enter your address → see your price" body="We measure your property from current aerial imagery and show your estimate in seconds." />
          <Step n={2} accent={accent} title="Pick a walkthrough time" body="Grab a free walkthrough slot that fits your schedule — we confirm the exact price on site." />
          <Step n={3} accent={accent} title="Relax — we handle it" body="Insured local crews keep your grounds sharp on a schedule you can count on." />
        </div>
        <div className="mt-10 text-center">
          <a href="#estimate" className="inline-block rounded-full px-7 py-3 text-sm font-semibold text-white shadow-sm" style={{ backgroundColor: accent }}>
            See my price →
          </a>
        </div>
      </section>

      {/* Why us */}
      <section className="bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-semibold">Why {name}</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Value accent={accent} title="No contracts" body="Skip, reschedule, or cancel anytime. We earn every visit." />
            <Value accent={accent} title="Licensed & insured" body="General liability coverage, with a certificate of insurance on request." />
            <Value accent={accent} title="Pricing you can see" body="Quotes built from measured turf and beds — not a windshield guess." />
            <Value accent={accent} title="Reliable crews" body="Vetted local crews who show up on schedule and leave the property sharp." />
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

      {/* Guarantee callout — honest: real guarantee + insurance, no invented stats */}
      <section className="mx-auto max-w-5xl px-6 pt-16">
        <div className="flex flex-col items-center gap-5 rounded-2xl border border-gray-200 bg-gray-50 p-8 text-center sm:flex-row sm:gap-8 sm:text-left">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-white" style={{ backgroundColor: accent }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold">Our satisfaction guarantee</h3>
            <p className="mt-1 text-gray-600">
              If a visit isn&apos;t right, tell us and we&apos;ll make it right — no argument. Every job is
              handled by licensed, insured crews, and we provide a certificate of insurance on request.
            </p>
          </div>
        </div>
      </section>

      {/* Reviews — honest placeholder; swap in real testimonials as earned */}
      <section className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h2 className="text-2xl font-semibold">Earning our reputation, one property at a time</h2>
        <p className="mt-3 text-gray-600">
          We&apos;re a growing local company, and every job is backed by our satisfaction guarantee:
          if it&apos;s not right, we make it right — no argument. Customer reviews will live here as
          we earn them.
        </p>
      </section>

      {/* FAQ */}
      <section className="bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-2xl font-semibold">Questions, answered</h2>
          <div className="mt-8 space-y-5">
            <Faq q="What's included?" a="A standard visit covers mowing, trimming and edging along walkways and beds, and blowing clippings off hard surfaces so the property looks sharp. We tailor the full scope to your property at the walkthrough." />
            <Faq q="How does the instant estimate work?" a="We locate your property, measure the lawn and beds from current aerial imagery, and apply our standard pricing — all in a few seconds." />
            <Faq q="Is the instant price exact?" a="It's a close estimate. We confirm the exact price at a quick, free walkthrough so there are no surprises either way." />
            <Faq q="Who will be servicing my property?" a="Vetted, insured local crews — not a rotating cast of strangers. The same team gets to know your property and keeps it consistent visit to visit." />
            <Faq q="How soon can you start?" a="After your free walkthrough we can typically begin within a few days, working around your schedule and ours." />
            <Faq q="Do I have to be home for service?" a="No. For recurring service you don't need to be home — just let us know about gates, pets, or anything else we should watch for." />
            <Faq q="Are there contracts?" a="No long-term contracts. Skip, reschedule, or cancel anytime." />
            <Faq q="Are you insured?" a="Yes — we carry general liability coverage and provide a certificate of insurance on request, which matters for commercial properties." />
          </div>
        </div>
      </section>

      {/* Repeated CTA */}
      <section className="px-6 py-16 text-center" style={{ backgroundColor: `${accent}0d` }}>
        <h2 className="text-2xl font-semibold">Ready for a sharper property?</h2>
        <p className="mt-2 text-gray-600">Enter your address and get your free estimate in seconds.</p>
        <a href="#estimate" className="mt-6 inline-block rounded-lg px-6 py-3 text-sm font-semibold text-white" style={{ backgroundColor: accent }}>
          See my price →
        </a>
      </section>
    </MarketingShell>
  );
}

function Step({ n, accent, title, body }: { n: number; accent: string; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="flex h-10 w-10 items-center justify-center rounded-full text-base font-semibold text-white" style={{ backgroundColor: accent }}>
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
