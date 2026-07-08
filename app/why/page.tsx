import Link from "next/link";
import { resolveTenant } from "@/lib/tenant";
import { exclusivePriceCents, leadPriceCents } from "@/lib/integrations/stripe";
import { leadMaxBuyers } from "@/lib/leads/availability";
import { Logo } from "@/components/Logo";
import { SiteFooter } from "@/components/SiteFooter";

// The economics page: WHY buying jobs here beats buying clicks, why the
// proactive approach beats waiting, and why we source high-intent signals.
// Same rule as the homepage — sell the WHAT, never the HOW (signal moments
// are public on every lead card; the sourcing machinery is the trade secret).
// Ad-market numbers are stated as typical industry ranges, never fabricated
// precision.
export const dynamic = "force-dynamic";

export default async function WhyPage() {
  const co = await resolveTenant();
  const brand = co?.name ?? "Greenkeep";
  const accent = co?.brand_color || "#2f7d4f";
  const cap = leadMaxBuyers();
  const sheetUsd = Math.round(leadPriceCents() / 100);
  const exclusiveUsd = Math.round(exclusivePriceCents() / 100);

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <header className="border-b border-gray-100">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/">
            <Logo name={brand} accent={accent} />
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link href="/buyers/login" className="text-gray-500 hover:text-gray-800">
              Sign in
            </Link>
            <Link
              href="/buyers/signup"
              className="rounded-lg px-4 py-2 font-semibold text-white"
              style={{ backgroundColor: accent }}
            >
              Get your free sheet
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-6 pt-16 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: accent }}>
          The economics
        </p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl">
          Buy the job, not the click.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-gray-600">
          Advertising rents attention from people who may never hire you. We hand you a specific
          commercial property, a reason its owner is deciding on vendors <em>right now</em>, and
          everything you need to go win it — for less than one afternoon of ad spend.
        </p>
      </section>

      {/* 1. The math */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-center text-3xl font-extrabold tracking-tight">
          The math, side by side
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-gray-600">
          A commercial grounds contract runs years, not visits. What matters is what you pay to
          land one.
        </p>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-7">
            <div className="text-sm font-semibold uppercase tracking-wider text-gray-400">
              Running ads
            </div>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed text-gray-700">
              <li>
                • Commercial service keywords typically cost <strong>$10–$30 a click</strong>, and
                it usually takes dozens of clicks to produce one inquiry — a raw inquiry commonly
                lands at <strong>$150–$400+</strong> before you&apos;ve spoken to anyone.
              </li>
              <li>
                • Most of those inquiries are residential, price-shopping, or out of your area.
                Big lead platforms resell the same homeowner to <strong>four or five companies at
                once</strong> — you pay to enter a bidding war.
              </li>
              <li>
                • Ads only reach people <em>already searching</em>. Commercial property owners
                rarely search — grounds contracts change hands through events, not Google.
              </li>
              <li>
                • The meter never stops: pause the spend and the pipeline dies the same week.
                Close one in eight paid inquiries and your acquisition cost sits around{" "}
                <strong>$1,500–$3,000 per won job</strong>.
              </li>
            </ul>
          </div>
          <div className="rounded-2xl border-2 p-7" style={{ borderColor: accent }}>
            <div className="text-sm font-semibold uppercase tracking-wider" style={{ color: accent }}>
              Buying the job sheet
            </div>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed text-gray-700">
              <li>
                • Sheets run <strong>$39–$129</strong> by contract size — priced off our aerial
                measurement of the actual property, typically an <strong>$8,000–$25,000+ per
                year</strong> recurring contract.
              </li>
              <li>
                • Every sheet answers the only question that matters: <em>why would this owner
                hire someone now?</em> You&apos;re not cold-calling a list — you&apos;re walking
                into an open decision.
              </li>
              <li>
                • Capped at <strong>{cap} companies*</strong> — or take it exclusive from ${exclusiveUsd}{" "}
                and it&apos;s closed to your competitors permanently.
              </li>
              <li>
                • Close one sheet in ten at ${sheetUsd} and your acquisition cost is about{" "}
                <strong>${sheetUsd * 10} for a multi-year contract</strong> — under 7% of
                first-year revenue, a few percent over the life of the contract. That ratio is
                what ads can&apos;t touch.
              </li>
            </ul>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-gray-400">
          Ad figures are typical industry ranges for commercial service categories; your market
          may vary. Contract values are our measured estimates, not guarantees.{" "}
          <Link href="/terms" className="underline">
            *Terms
          </Link>
        </p>
      </section>

      {/* 2. Proactive vs passive */}
      <section className="border-t border-gray-100 bg-gray-50">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="text-center text-3xl font-extrabold tracking-tight">
            Show up before the search happens
          </h2>
          <div className="mx-auto mt-8 grid max-w-4xl gap-5 md:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-7 text-sm leading-relaxed text-gray-700">
              <div className="font-semibold text-gray-900">Waiting (ads, referrals, public bids)</div>
              <p className="mt-3">
                By the time a property manager is openly soliciting bids, every competitor you
                have is in the room. You compete at the moment of <em>maximum</em> competition,
                and the job goes to whoever cuts margin deepest. Your pipeline is a function of
                luck, season, and someone else&apos;s timing.
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-7 text-sm leading-relaxed text-gray-700">
              <div className="font-semibold text-gray-900">Proactive (working the decision window)</div>
              <p className="mt-3">
                Vendor decisions happen at knowable moments — a sale closes, a business opens, a
                citation lands. Reach the owner <em>inside</em> that window and you&apos;re often
                the only bidder at the table. Same job, no bidding war, full-margin pricing. Your
                pipeline becomes a function of how many windows you work — a number you control.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 3. The signals */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-center text-3xl font-extrabold tracking-tight">
          Why we only sell high-intent moments
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-gray-600">
          A list tells you a property exists. A signal tells you its owner is deciding. We only
          put a job on the shelf when something has <em>forced the question</em>:
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Ownership changed", "New owners re-bid their vendors in the first year. The incumbent — if there is one — is beatable right now."],
            ["A business is opening", "First contracts are being signed in the weeks before the doors open. Whoever shows up gets considered."],
            ["The city issued a citation", "Overgrowth, dumping, nuisance — the owner is required to arrange service, usually within days. The most urgent signal there is."],
            ["Tax-sale pressure", "Distressed properties need cleanup now, and the next owner re-bids everything. Forced action on both sides of the sale."],
            ["Construction completing", "A brand-new property's first grounds contract hasn't been won by anyone. Get on the bidder list before it opens."],
            ["Public contracts out for bid", "Government grounds work with hard deadlines — multi-year money most small companies never hear about in time."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-gray-200 p-6">
              <div className="text-sm font-bold" style={{ color: accent }}>
                {title}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{body}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-gray-600">
          Then we do the estimator&apos;s homework before you spend a minute: verify it&apos;s a
          real commercial parcel, measure the grounds from the air, size the contract, find the
          owner and the decision window, and write the intro letter. One page, ready to act on.
        </p>
      </section>

      {/* CTA */}
      <section className="border-t border-gray-100 bg-gray-50">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
          <h2 className="text-3xl font-extrabold tracking-tight">Run the math on one job</h2>
          <p className="mx-auto mt-3 max-w-xl text-gray-600">
            Your first job sheet is free — no card, 30 seconds. If the numbers on it don&apos;t
            beat your cost per lead, you&apos;ve lost nothing.
          </p>
          <Link
            href="/buyers/signup"
            className="mt-7 inline-block rounded-xl px-8 py-3.5 text-base font-semibold text-white shadow-sm"
            style={{ backgroundColor: accent }}
          >
            Claim your free sheet
          </Link>
          <p className="mt-4 text-xs text-gray-400">
            Every job capped at {cap} companies*.{" "}
            <Link href="/terms" className="underline">
              *Terms
            </Link>
          </p>
        </div>
      </section>
      <SiteFooter name={brand} accent={accent} email={co?.email ?? null} />
    </main>
  );
}
