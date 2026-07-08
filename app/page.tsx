import Link from "next/link";
import { desc, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { leadUnlock, property } from "@/lib/db/schema";
import { resolveTenant } from "@/lib/tenant";
import { exclusivePriceCents, leadPriceCents } from "@/lib/integrations/stripe";
import { leadMaxBuyers } from "@/lib/leads/availability";
import { Logo } from "@/components/Logo";
import { ChatWidget } from "@/components/ChatWidget";
import { startChat } from "./buyers/actions";

// Homepage for the PIVOT: job intelligence for commercial landscaping
// companies. Sells the WHAT (high-value leads, measured, priced, contacts,
// tight cap) and never the HOW — sourcing is the trade secret. Stats are
// computed from real data; the hero shows a REDACTED sample sheet (structure
// real, specifics blurred) instead of stock art. Nothing fabricated.
export const dynamic = "force-dynamic";

const noteRe = (notes: string | null, re: RegExp) => notes?.match(re)?.[1]?.trim() ?? null;

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
    const c = noteRe(p.notes, /est\. cost \$([\d,]+)/);
    if (c) devValue += Number(c.replace(/,/g, ""));
  }
  return { openJobs: open.length, devValue };
}

/** Redacted sample job sheet — shows the product's structure, hides the goods. */
function MockSheet({ accent }: { accent: string }) {
  const Blur = ({ w }: { w: string }) => (
    <span className={`inline-block h-3 ${w} rounded bg-gray-300/90 align-middle blur-[2px]`} />
  );
  return (
    <div className="relative mx-auto w-full max-w-md">
      {/* depth card */}
      <div className="absolute inset-0 translate-x-3 translate-y-3 rounded-2xl bg-white/10" />
      <div className="relative rotate-[-1deg] rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-black/5">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Sample job sheet · GK-XXXXX
          </div>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
            style={{ backgroundColor: accent }}
          >
            2 of 3 spots left
          </span>
        </div>
        <div className="mt-2 text-lg font-bold leading-tight text-gray-900">
          <Blur w="w-40" /> <Blur w="w-16" />
        </div>
        <div className="mt-1 text-xs text-gray-500">
          <Blur w="w-24" />, Houston metro · 50.7 ac
        </div>

        {/* stylized aerial with measurement overlay */}
        <svg viewBox="0 0 400 210" className="mt-4 w-full rounded-xl" role="img" aria-label="Aerial measurement preview">
          <rect width="400" height="210" fill="#26332a" />
          <rect x="0" y="0" width="400" height="210" fill="url(#g1)" opacity="0.5" />
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#2f4636" />
              <stop offset="1" stopColor="#1d2a22" />
            </linearGradient>
          </defs>
          {/* roads */}
          <rect x="0" y="150" width="400" height="18" fill="#4a4f4a" />
          <rect x="288" y="0" width="16" height="160" fill="#4a4f4a" />
          {/* building + parking */}
          <rect x="60" y="38" width="120" height="66" rx="2" fill="#8b8f8c" />
          <rect x="60" y="112" width="150" height="30" rx="2" fill="#5c615d" />
          {/* turf polygons */}
          <path d="M200 30 L282 30 L282 96 L226 96 L200 66 Z" fill={accent} fillOpacity="0.45" stroke={accent} strokeWidth="2.5" />
          <path d="M40 118 L52 108 L52 144 L26 144 L26 128 Z" fill={accent} fillOpacity="0.45" stroke={accent} strokeWidth="2.5" />
          <path d="M226 108 L282 108 L282 142 L218 142 Z" fill={accent} fillOpacity="0.45" stroke={accent} strokeWidth="2.5" />
          {/* parcel boundary */}
          <rect x="16" y="14" width="276" height="140" fill="none" stroke="#ffffff" strokeWidth="1.5" strokeDasharray="6 5" opacity="0.85" />
          <text x="238" y="66" fontSize="11" fontWeight="700" fill="#ffffff" textAnchor="middle" fontFamily="ui-monospace, monospace">212,400 sf</text>
          <text x="250" y="128" fontSize="10" fontWeight="700" fill="#ffffff" textAnchor="middle" fontFamily="ui-monospace, monospace">88,150 sf</text>
        </svg>

        {/* stat tiles */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            ["Contract value", "$38k–52k/yr"],
            ["Turf measured", "384,200 sf"],
            ["Crew / visit", "6.2 hrs"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-gray-50 p-2.5">
              <div className="text-[9px] font-medium uppercase tracking-wide text-gray-400">{k}</div>
              <div className="mt-0.5 text-sm font-bold text-gray-900">{v}</div>
            </div>
          ))}
        </div>

        {/* locked contacts */}
        <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Decision contacts
            </div>
            <span className="text-[10px] font-medium text-gray-400">🔒 unlocks with the sheet</span>
          </div>
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="w-14 shrink-0">Owner</span> <Blur w="w-44" />
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="w-14 shrink-0">Mail</span> <Blur w="w-52" />
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="w-14 shrink-0">Architect</span> <Blur w="w-36" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
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
      {/* Sticky header */}
      <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <Link href="/" aria-label={name}>
            <Logo accent={accent} name={name} />
          </Link>
          <nav className="flex shrink-0 items-center gap-3 sm:gap-5">
            <Link href="#how" className="hidden text-sm text-gray-600 hover:text-gray-900 md:inline">
              How it works
            </Link>
            <Link href="#pricing" className="hidden text-sm text-gray-600 hover:text-gray-900 md:inline">
              Pricing
            </Link>
            <Link href="/buyers/login" className="whitespace-nowrap text-sm text-gray-600 hover:text-gray-900">
              Sign in
            </Link>
            <Link
              href="/buyers/signup"
              className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 sm:px-4"
              style={{ backgroundColor: accent }}
            >
              <span className="sm:hidden">See jobs</span>
              <span className="hidden sm:inline">See jobs near you</span>
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero — dark, product-forward */}
      <section className="relative overflow-hidden bg-[#101d15] px-6 pb-16 pt-16 text-white sm:pt-20">
        <div
          className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[52rem] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
          style={{ backgroundColor: accent }}
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: "#7fc79b" }}>
              High-intent leads for commercial landscapers
            </p>
            <h1 className="mt-4 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-[3.4rem]">
              Your next commercial contract,{" "}
              <span style={{ color: "#8fd6ab" }}>on one page.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-gray-300">
              Every job on your dashboard is a verified commercial property that&apos;s about to
              need a grounds crew. <strong className="text-white">Somebody wins that contract.</strong>{" "}
              {name} puts you in the room first — site measured from the air, value priced, the
              decision-maker&apos;s name on one page.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/buyers/signup"
                className="rounded-xl px-7 py-3.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
                style={{ backgroundColor: accent }}
              >
                Get your first job sheet free
              </Link>
              <Link
                href="#how"
                className="rounded-xl border border-white/20 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-white/5"
              >
                How it works
              </Link>
            </div>
            <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-300">
              {["First sheet free — no card", `Max ${cap} companies per job`, "No subscription"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <span style={{ color: "#8fd6ab" }}>✓</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <MockSheet accent={accent} />
        </div>

        {/* Live, factual numbers */}
        {openJobs > 0 ? (
          <div className="relative mx-auto mt-14 flex max-w-6xl flex-wrap items-center justify-center gap-x-12 gap-y-3 border-t border-white/10 pt-7 text-sm text-gray-400">
            <span>
              <strong className="text-white">{openJobs}</strong> job{openJobs === 1 ? "" : "s"} open right now
            </span>
            {devValue > 0 ? (
              <span>
                backed by{" "}
                <strong className="text-white">${Math.round(devValue / 1_000_000).toLocaleString()}M</strong>{" "}
                in verified commercial projects
              </span>
            ) : null}
            <span>Houston metro</span>
          </div>
        ) : null}
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-16 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <p className="text-center text-xs font-bold uppercase tracking-[0.2em]" style={{ color: accent }}>
            How it works
          </p>
          <h2 className="mt-3 text-center text-3xl font-extrabold tracking-tight sm:text-4xl">
            Three steps to the owner&apos;s desk
          </h2>
          <div className="relative mt-12 grid gap-6 md:grid-cols-3">
            <div className="absolute left-[16.6%] right-[16.6%] top-9 hidden border-t-2 border-dashed border-gray-200 md:block" />
            {[
              ["Tell us where you work", "Create a free profile with your office city. Your dashboard fills with high-intent jobs near you — real properties that will award a grounds contract, value shown up front."],
              ["Unlock the full sheet", "One page per job: exact address with the grounds measured from the air, estimated annual value, the decision contacts, crew sizing, and when to act."],
              ["Bid nearly alone", `You're one of at most ${cap} companies that will ever see it. Send the included intro letter and be the first bid on the owner's desk.`],
            ].map(([title, body], i) => (
              <div key={title} className="relative rounded-2xl border border-gray-200 bg-white p-7 shadow-sm">
                <div
                  className="relative z-10 flex h-11 w-11 items-center justify-center rounded-full text-base font-extrabold text-white ring-4 ring-white"
                  style={{ backgroundColor: accent }}
                >
                  {i + 1}
                </div>
                <h3 className="mt-5 text-lg font-bold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What's on the sheet */}
      <section className="bg-gray-50 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <p className="text-center text-xs font-bold uppercase tracking-[0.2em]" style={{ color: accent }}>
            The job sheet
          </p>
          <h2 className="mt-3 text-center text-3xl font-extrabold tracking-tight sm:text-4xl">
            Everything a bidder needs, on one page
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-gray-600">
            This isn&apos;t a list of businesses that might want a quote someday. Each sheet is a
            property that&apos;s about to award a grounds contract — and the whole play to win it.
          </p>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sheetItems.map(([title, body]) => (
              <div
                key={title}
                className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition hover:shadow-md"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold text-white"
                    style={{ backgroundColor: accent }}
                  >
                    ✓
                  </span>
                  <h3 className="text-sm font-bold">{title}</h3>
                </div>
                <p className="mt-2.5 text-sm leading-relaxed text-gray-600">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Scarcity + pricing */}
      <section id="pricing" className="scroll-mt-16 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <p className="text-center text-xs font-bold uppercase tracking-[0.2em]" style={{ color: accent }}>
            Pricing
          </p>
          <h2 className="mt-3 text-center text-3xl font-extrabold tracking-tight sm:text-4xl">
            We never oversell a lead
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-gray-600">
            Lead lists die when everyone has the same list. Every job here is capped at {cap}{" "}
            companies* — ever — and you can lock one down so nobody else gets it at all.{" "}
            <Link href="/terms" className="text-sm underline">*Terms</Link>
          </p>
          <div className="mt-12 grid gap-5 sm:grid-cols-3">
            <div className="flex flex-col rounded-2xl border border-gray-200 bg-white p-7">
              <div className="text-sm font-semibold text-gray-500">First sheet</div>
              <div className="mt-2 text-4xl font-extrabold">Free</div>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-gray-600">
                Judge the quality on a real job before spending a dime. No card required.
              </p>
              <Link
                href="/buyers/signup"
                className="mt-6 rounded-lg border border-gray-300 px-4 py-2.5 text-center text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
              >
                Claim it
              </Link>
            </div>
            <div
              className="relative flex flex-col rounded-2xl bg-white p-7 shadow-xl ring-2"
              style={{ ["--tw-ring-color" as string]: accent }}
            >
              <span
                className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white"
                style={{ backgroundColor: accent }}
              >
                Most jobs
              </span>
              <div className="text-sm font-semibold text-gray-500">Job sheet</div>
              <div className="mt-2 text-4xl font-extrabold">
                ${price}
                <span className="text-base font-semibold text-gray-400"> / job</span>
              </div>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-gray-600">
                One-time. Shared with no more than {cap} companies, first come, first served.
              </p>
              <Link
                href="/buyers/signup"
                className="mt-6 rounded-lg px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:opacity-90"
                style={{ backgroundColor: accent }}
              >
                See open jobs
              </Link>
            </div>
            <div className="flex flex-col rounded-2xl border border-gray-200 bg-white p-7">
              <div className="text-sm font-semibold text-gray-500">Exclusive</div>
              <div className="mt-2 text-4xl font-extrabold">
                ${exclusivePrice}
                <span className="text-base font-semibold text-gray-400"> / job</span>
              </div>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-gray-600">
                Yours alone — the job is closed to everyone else, permanently.
              </p>
              <Link
                href="/buyers/signup"
                className="mt-6 rounded-lg border border-gray-300 px-4 py-2.5 text-center text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
              >
                Lock one down
              </Link>
            </div>
          </div>
          <p className="mt-7 text-center text-xs text-gray-400">
            If a job sells out before your payment settles, your payment instantly becomes account
            credit for any other job — it never disappears.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-gray-50 px-6 py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-3xl font-extrabold tracking-tight">Questions</h2>
          <div className="mt-10 space-y-4">
            {[
              ["Where do these leads come from?", "That's the trade secret — and the reason a sheet is worth paying for. What matters to you: every lead is a real, verified commercial property that is going to need grounds maintenance — measured and priced before it reaches your dashboard. Judge us on the free one."],
              [`Why cap a job at ${cap} companies?`, "Because a lead shared with fifty companies is worthless. A tight cap keeps every sheet worth bidding on, and the exclusive option exists when you want zero competition."],
              ["What if the free sheet isn't good?", "Then you close the tab and you've lost nothing. We put a real job — measurement, contacts, letter — in your hands first because the sheet is the sales pitch."],
            ].map(([q, a]) => (
              <div key={q} className="rounded-2xl border border-gray-200 bg-white p-6">
                <h3 className="font-bold">{q}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA band */}
      <section className="bg-[#101d15] px-6 py-16 text-center text-white">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight">Your first job sheet is free.</h2>
          <p className="mt-3 text-gray-300">
            A real job — measured, priced, contacts included. If it&apos;s not worth bidding,
            you&apos;ve lost nothing.
          </p>
          <Link
            href="/buyers/signup"
            className="mt-7 inline-block rounded-xl px-8 py-3.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
            style={{ backgroundColor: accent }}
          >
            Create your free profile
          </Link>
        </div>
      </section>

      {/* Owner fork + footer */}
      <footer className="border-t border-gray-100 bg-gray-50">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="flex flex-col items-center justify-between gap-6 rounded-2xl border border-gray-200 bg-white p-6 text-center sm:flex-row sm:text-left">
            <div>
              <h2 className="font-bold">Own or manage a property?</h2>
              <p className="mt-1 text-sm text-gray-600">
                {name} also prices grounds maintenance directly — free instant estimate, no phone
                call.
              </p>
            </div>
            <div className="flex shrink-0 gap-3">
              <Link
                href="/commercial"
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Commercial quote
              </Link>
              <Link
                href="/residential"
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Residential quote
              </Link>
            </div>
          </div>
          <div className="mt-10 flex flex-col items-center justify-between gap-4 sm:flex-row">
            <Logo accent={accent} name={name} size={24} />
            <div className="text-sm text-gray-500">
              {co?.email ? (
                <a href={`mailto:${co.email}`} className="font-medium hover:text-gray-800">
                  {co.email}
                </a>
              ) : null}
            </div>
            <p className="text-xs text-gray-400">
              © {name} · <Link href="/buyers/login" className="hover:text-gray-600">Buyer sign-in</Link> ·{" "}
              <Link href="/customer/login" className="hover:text-gray-600">Customer sign-in</Link> ·{" "}
              <Link href="/login" className="hover:text-gray-600">Operator login</Link>
            </p>
          </div>
        </div>
      </footer>

      <ChatWidget mode="anon" accent={accent} startAction={startChat} />
    </div>
  );
}
