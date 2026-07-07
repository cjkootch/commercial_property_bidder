import Link from "next/link";
import { desc, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { leadUnlock, property } from "@/lib/db/schema";
import { resolveTenant } from "@/lib/tenant";
import { exclusivePriceCents, leadPriceCents } from "@/lib/integrations/stripe";
import { leadMaxBuyers } from "@/lib/leads/availability";
import { Logo } from "@/components/Logo";

// Homepage for the PIVOT: the product is job intelligence for commercial
// landscaping companies. Audience = contractors (lead buyers); the instant-
// quote funnel for property owners stays reachable through the fork section.
// Every stat on this page is computed from real data — nothing fabricated.
// Copy never reveals HOW jobs are found (that's the moat).
export const dynamic = "force-dynamic";

const note = (notes: string | null, re: RegExp) => notes?.match(re)?.[1]?.trim() ?? null;

async function openJobStats() {
  const cap = leadMaxBuyers();
  const rows = await db
    .select()
    .from(property)
    .where(like(property.name, "%(TABS %"))
    .orderBy(desc(property.created_at));
  const unlocks = await db
    .select({ pid: leadUnlock.property_id, kind: leadUnlock.kind })
    .from(leadUnlock);
  const count = new Map<string, number>();
  const exclusive = new Set<string>();
  for (const u of unlocks) {
    count.set(u.pid, (count.get(u.pid) ?? 0) + 1);
    if (u.kind === "exclusive") exclusive.add(u.pid);
  }
  const open = rows.filter(
    (p) =>
      p.lead_exported_at == null &&
      p.parcel_geojson != null &&
      !exclusive.has(p.id) &&
      (count.get(p.id) ?? 0) < cap
  );
  let devValue = 0;
  for (const p of open) {
    const c = note(p.notes, /est\. cost \$([\d,]+)/);
    if (c) devValue += Number(c.replace(/,/g, ""));
  }
  return { openJobs: open.length, devValue };
}

export default async function Home() {
  const co = await resolveTenant();
  const name = co?.name ?? "Greenkeep";
  const accent = co?.brand_color || "#2f7d4f";
  const price = Math.round(leadPriceCents() / 100);
  const exclusivePrice = Math.round(exclusivePriceCents() / 100);
  const cap = leadMaxBuyers();
  const { openJobs, devValue } = await openJobStats();

  const sheetItems = [
    ["Exact address + aerial", "The site from above with the maintainable grounds measured — before you ever roll a truck."],
    ["Contract value estimate", "Annual and monthly maintenance value at market rates, from our measurement."],
    ["Decision contacts", "The owner (with mailing address), tenant, and architect — who actually awards the work."],
    ["When to act", "The date to be in front of the owner by — so you're not too early and never too late."],
    ["Crew sizing", "Estimated crew-hours per visit so you can price it profitably in minutes."],
    ["Ready-to-send intro letter", "Fill in your letterhead and send — the first touch is written for you."],
    ["Route intelligence", "What other measured commercial work sits within 3 miles, so one contract anchors a route."],
  ] as const;

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <header className="border-b border-gray-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" aria-label={name}>
            <Logo accent={accent} name={name} />
          </Link>
          <nav className="flex items-center gap-5">
            <Link href="/buyers/login" className="text-sm text-gray-600 hover:text-gray-900">
              Sign in
            </Link>
            <Link
              href="/buyers/signup"
              className="rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: accent }}
            >
              See jobs near you
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 pt-16 pb-12" style={{ backgroundColor: `${accent}0d` }}>
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: accent }}>
              For commercial landscaping companies
            </p>
            <h1 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl">
              Your next commercial contract, on one page.
            </h1>
            <p className="mt-4 max-w-xl text-lg text-gray-600">
              {name} sells high-value commercial grounds leads — measured from the air, priced at
              market rates, decision-maker included. Each one goes to no more than {cap} companies,
              ever. First come, first served.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/buyers/signup"
                className="rounded-lg px-6 py-3 text-sm font-medium text-white"
                style={{ backgroundColor: accent }}
              >
                Get your first job sheet free
              </Link>
              <Link href="#how" className="text-sm font-medium text-gray-700 hover:text-gray-900">
                How it works ↓
              </Link>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-700">
              {["First sheet free — no card", `Max ${cap} companies per job`, "No subscription"].map((t) => (
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
            alt="Aerial view of a commercial property with the grounds measured"
            width={1600}
            height={960}
            className="hidden h-auto w-full rounded-2xl lg:block"
          />
        </div>
      </section>

      {/* Live, factual numbers */}
      {openJobs > 0 ? (
        <section className="border-b border-gray-100 px-6 py-6">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-2 text-sm text-gray-600">
            <span>
              <strong className="text-gray-900">{openJobs}</strong> job{openJobs === 1 ? "" : "s"} open right now
            </span>
            {devValue > 0 ? (
              <span>
                backed by{" "}
                <strong className="text-gray-900">${Math.round(devValue / 1_000_000).toLocaleString()}M</strong>{" "}
                in verified commercial projects
              </span>
            ) : null}
            <span>Houston metro</span>
          </div>
        </section>
      ) : null}

      {/* How it works */}
      <section id="how" className="px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold">How it works</h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {[
              ["Tell us where you work", "Create a free profile with your office city. Your dashboard fills with high-value commercial jobs near you — contract value shown up front."],
              ["Unlock the full sheet", "One page per job: exact address with the grounds measured from the air, estimated annual value, the decision contacts, crew sizing, and when to act."],
              ["Bid nearly alone", `You're one of at most ${cap} companies that will ever see it. Send the included intro letter and be the first bid on the owner's desk.`],
            ].map(([title, body], i) => (
              <div key={title} className="rounded-2xl border border-gray-200 p-6">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ backgroundColor: accent }}
                >
                  {i + 1}
                </div>
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-gray-600">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What's on the sheet */}
      <section className="bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold">Everything a bidder needs, on one page</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-gray-600">
            A job sheet isn&apos;t a name and a phone number. It&apos;s the whole play.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sheetItems.map(([title, body]) => (
              <div key={title} className="rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm text-gray-600">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Scarcity + pricing */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-3xl font-bold">We never oversell a lead</h2>
          <p className="mx-auto mt-3 max-w-2xl text-gray-600">
            Lead lists die when everyone has the same list. Every job here is capped at {cap}{" "}
            companies — ever — and you can lock one down so nobody else gets it at all.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 p-6 text-left">
              <div className="text-sm font-semibold text-gray-500">First sheet</div>
              <div className="mt-1 text-3xl font-bold">Free</div>
              <p className="mt-2 text-sm text-gray-600">
                Judge the quality on a real job before spending a dime. No card required.
              </p>
            </div>
            <div className="rounded-2xl border-2 p-6 text-left" style={{ borderColor: accent }}>
              <div className="text-sm font-semibold text-gray-500">Job sheet</div>
              <div className="mt-1 text-3xl font-bold">${price}</div>
              <p className="mt-2 text-sm text-gray-600">
                Per job, one-time. Shared with no more than {cap} companies, first come, first
                served.
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 p-6 text-left">
              <div className="text-sm font-semibold text-gray-500">Exclusive</div>
              <div className="mt-1 text-3xl font-bold">${exclusivePrice}</div>
              <p className="mt-2 text-sm text-gray-600">
                Yours alone — the job is closed to everyone else, permanently.
              </p>
            </div>
          </div>
          <p className="mt-6 text-xs text-gray-400">
            If a job sells out before your payment settles, your payment instantly becomes account
            credit for any other job — it never disappears.
          </p>
          <Link
            href="/buyers/signup"
            className="mt-8 inline-block rounded-lg px-8 py-3 text-sm font-medium text-white"
            style={{ backgroundColor: accent }}
          >
            See the jobs open near you
          </Link>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-3xl font-bold">Questions</h2>
          <div className="mt-8 space-y-4">
            {[
              ["Where do these leads come from?", "That's the trade secret — and the reason a sheet is worth paying for. What matters to you: every lead is a real, verified commercial project, measured and priced before it reaches your dashboard. Judge us on the free one."],
              [`Why cap a job at ${cap} companies?`, "Because a lead shared with fifty companies is worthless. A tight cap keeps every sheet worth bidding on, and the exclusive option exists when you want zero competition."],
              ["What if the free sheet isn't good?", "Then you close the tab and you've lost nothing. We put a real job — measurement, contacts, letter — in your hands first because the sheet is the sales pitch."],
            ].map(([q, a]) => (
              <div key={q} className="rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="text-sm font-semibold">{q}</h3>
                <p className="mt-1.5 text-sm text-gray-600">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Owner fork — the instant-quote funnel stays alive */}
      <section className="px-6 py-12">
        <div className="mx-auto max-w-6xl rounded-2xl border border-gray-200 p-8 text-center">
          <h2 className="text-lg font-semibold">Own or manage a property?</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-gray-600">
            {name} also prices grounds maintenance directly — get a free instant estimate from an
            aerial measurement of your property, no phone call required.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link
              href="/commercial"
              className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Commercial quote
            </Link>
            <Link
              href="/residential"
              className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Residential quote
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-gray-50">
        <div className="mx-auto max-w-6xl px-6 py-10 text-center">
          <h2 className="text-lg font-semibold">Your first job sheet is free</h2>
          <Link
            href="/buyers/signup"
            className="mt-4 inline-block rounded-lg px-6 py-3 text-sm font-medium text-white"
            style={{ backgroundColor: accent }}
          >
            Create your free profile
          </Link>
          <div className="mt-6 text-sm text-gray-600">
            {co?.email ? (
              <a href={`mailto:${co.email}`} className="font-medium" style={{ color: accent }}>
                {co.email}
              </a>
            ) : null}
          </div>
          <p className="mt-6 text-xs text-gray-400">
            © {name}. · <Link href="/buyers/login" className="hover:text-gray-600">Buyer sign-in</Link> ·{" "}
            <Link href="/customer/login" className="hover:text-gray-600">Customer sign-in</Link> ·{" "}
            <Link href="/login" className="hover:text-gray-600">Operator login</Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
