import Link from "next/link";
import { resolveTenant } from "@/lib/tenant";
import { MARKETS } from "@/lib/markets";
import { TRADES } from "@/lib/leads/trades";
import { leadMaxBuyers } from "@/lib/leads/availability";
import { Logo } from "@/components/Logo";
import { SiteFooter } from "@/components/SiteFooter";

// About: the diligence page. A skeptical buyer lands here asking "who are
// these people?" — the answer is our operating rules, because that's what
// actually distinguishes this marketplace. Same content rule as everywhere:
// every claim on this page must be live-true; nothing biographical gets
// invented to look bigger than we are.
export const dynamic = "force-dynamic";

export default async function AboutPage() {
  const co = await resolveTenant();
  const brand = co?.name ?? "Greenkeep";
  const accent = co?.brand_color || "#2f7d4f";
  const metros = Object.values(MARKETS);
  const tradeCount = Object.keys(TRADES).length;
  const cap = leadMaxBuyers();

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

      <section className="mx-auto max-w-3xl px-6 pt-16">
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: accent }}>
          About
        </p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight">
          Job intelligence for commercial service companies.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-gray-600">
          {brand} is a Texas-based lead marketplace. We monitor independent public signal
          sources — county, state, and municipal systems — for the moments a commercial
          property is about to buy services: a building changing hands, a restaurant
          about to open, a citation forcing action, a tax sale in motion. We verify each
          signal against county parcel records, price the opportunity from real data,
          and sell the finished job sheet to a strictly limited number of local
          companies.
        </p>

        <h2 className="mt-12 text-2xl font-bold tracking-tight">The rules we run on</h2>
        <p className="mt-2 text-sm text-gray-500">
          These aren&apos;t marketing lines — they&apos;re enforced in the software that
          builds every lead and every email.
        </p>
        <div className="mt-6 space-y-5">
          {[
            [
              `A job sells to at most ${cap} companies per trade. Ever.`,
              "The cap is enforced in the database, not the copy. When a sheet says “last spot,” it is the last spot.",
            ],
            [
              "Every claim is live-true or it doesn't ship.",
              "Scarcity counts, freshness dates, and value estimates are computed from real records at send time. If the data to say a number honestly isn't there, the sheet says less instead of making one up.",
            ],
            [
              "Estimates come from county records, never invention.",
              "Contract-value bands are derived from appraisal-district data — building size, land, improvements — with the basis printed on the sheet so you can check our math.",
            ],
            [
              "We never sell a residence as a commercial lead.",
              "Every lead is gated against county land-use classification before it reaches the shelf.",
            ],
            [
              "No spam machinery.",
              "One follow-up maximum per offer, unsubscribes honored instantly, and companies that ask to be left alone stay left alone.",
            ],
          ].map(([h, b]) => (
            <div key={h as string} className="rounded-xl border border-gray-200 p-5">
              <div className="font-semibold text-gray-900">{h}</div>
              <p className="mt-1 text-sm leading-relaxed text-gray-600">{b}</p>
            </div>
          ))}
        </div>

        <h2 className="mt-12 text-2xl font-bold tracking-tight">Where we operate</h2>
        <p className="mt-3 leading-relaxed text-gray-600">
          {metros.length} Texas metros today —{" "}
          {metros.map((m) => m.label.replace(/ metro$/, "")).join(", ")} — across{" "}
          {tradeCount} commercial service trades, and expanding metro by metro. In every
          market the goal is the same: the most complete picture of who&apos;s about to
          buy, with every lead verified against county records before it&apos;s sold.
        </p>

        <h2 className="mt-12 text-2xl font-bold tracking-tight">Talk to a human</h2>
        <p className="mt-3 leading-relaxed text-gray-600">
          Questions about a lead, a market, or how we work?{" "}
          <a href="mailto:leads@greenkeep.us" className="font-semibold underline" style={{ color: accent }}>
            leads@greenkeep.us
          </a>{" "}
          — or see the <Link href="/contact" className="underline">contact page</Link>.
        </p>

        <div className="mt-12 mb-16 rounded-2xl border border-gray-200 bg-gray-50 p-6 text-center">
          <div className="text-lg font-bold">See a real job sheet for your trade.</div>
          <p className="mt-1 text-sm text-gray-600">Your first one is free — no card required.</p>
          <Link
            href="/buyers/signup"
            className="mt-4 inline-block rounded-lg px-6 py-2.5 font-semibold text-white"
            style={{ backgroundColor: accent }}
          >
            Get your free sheet
          </Link>
        </div>
      </section>

      <SiteFooter name={brand} accent={accent} email={co?.email ?? null} />
    </main>
  );
}
