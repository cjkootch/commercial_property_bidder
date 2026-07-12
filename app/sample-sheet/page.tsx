import Link from "next/link";
import { desc, eq, isNotNull } from "drizzle-orm";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { leadUnlock, property } from "@/lib/db/schema";
import { getDefaultCompany } from "@/lib/db/queries";
import { leadMaxBuyers } from "@/lib/leads/availability";
import type { Dossier } from "@/lib/leads/dossier";
import { leadKind } from "@/lib/leads/market";
import { playbookFor } from "@/lib/leads/playbook";
import { Logo } from "@/components/Logo";
import { BidCalculator } from "@/components/BidCalculator";

// PUBLIC sample job sheet — a REAL sold sheet from the marketplace with the
// identifying details redacted. Every funnel stage previously asked prospects
// to trust a description of the product; this lets them hold one. Uses the
// dossier SNAPSHOT from the newest unlock (no imagery quota spent, and being
// already-sold means showing it leaks nothing sellable). Linked from the
// claim page, the homepage, and the SMS AI's repertoire.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Greenkeep — sample job sheet",
  description:
    "A real Greenkeep job intelligence sheet with the identifying details redacted — exact property, contacts, measurement, pricing guidance, and the ready-to-send intro letter.",
};

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
/** Redaction bars sized like the hidden words — reads as "real but hidden". */
const mask = (s: string) =>
  s
    .split(/\s+/)
    .map((w) => "▮".repeat(Math.max(3, Math.min(w.length, 9))))
    .join(" ");

export default async function SampleSheet() {
  // Prefer a landscaping sheet (the measurement story shows best), else the
  // newest sold sheet with a dossier snapshot.
  const pick = async (trade?: string) => {
    const rows = await db
      .select({
        dossier: leadUnlock.dossier,
        trade: leadUnlock.trade,
        prop_name: property.name,
      })
      .from(leadUnlock)
      .innerJoin(property, eq(leadUnlock.property_id, property.id))
      .where(trade ? eq(leadUnlock.trade, trade) : isNotNull(leadUnlock.dossier))
      .orderBy(desc(leadUnlock.created_at))
      .limit(10);
    return rows.find((r) => {
      const d = r.dossier as Dossier | null;
      return d && d.aerial && d.contacts.length > 0;
    });
  };
  const row = (await pick("landscaping")) ?? (await pick());
  const co = await getDefaultCompany();
  const brand = co?.name ?? "Greenkeep";
  const cap = leadMaxBuyers();

  if (!row) {
    return (
      <Shell brand={brand}>
        <p className="mt-10 text-center text-sm text-gray-500">
          The sample sheet is being refreshed — check back shortly, or{" "}
          <Link href="/buyers/signup" className="font-semibold text-brand underline">
            create a free profile
          </Link>{" "}
          to see live jobs near you.
        </p>
      </Shell>
    );
  }

  const d = row.dossier as Dossier;
  const pb = playbookFor(leadKind(row.prop_name), row.trade);

  return (
    <Shell brand={brand}>
      {/* What this is */}
      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <span className="font-bold">This is a real job sheet</span> sold on our marketplace — only
        the identifying details are redacted. When you claim or buy a sheet, every ▮ below is
        filled in.
      </div>

      {/* Title block */}
      <div className="mt-6">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          <span>{d.gk_ref}</span>
          <span>·</span>
          <span>prepared {d.prepared_at}</span>
          <span className="rounded-full bg-brand px-2.5 py-0.5 text-[10px] font-bold text-white">
            CAPPED AT {cap} COMPANIES
          </span>
          {d.verified ? (
            <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-bold text-white">
              VERIFIED MEASUREMENT
            </span>
          ) : null}
        </div>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-gray-400 sm:text-3xl">
          {mask(d.name)}
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          {mask(d.address ?? "1234 Redacted Dr")}, {d.city ?? "Houston"}
          {d.county ? ` · ${d.county} County` : ""}
        </p>
      </div>

      {/* Aerial with real measurement overlay */}
      {d.aerial ? (
        <div className="relative mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-gray-900 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={d.aerial.image} alt="Aerial of the sample property" className="w-full" />
          {d.aerial.mask ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.aerial.mask} alt="" className="absolute inset-0 h-full w-full" />
          ) : null}
          <svg
            viewBox={`0 0 ${d.aerial.width} ${d.aerial.height}`}
            className="absolute inset-0 h-full w-full"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {d.aerial.outline.map((pts, i) => (
              <polygon
                key={i}
                points={pts}
                fill="none"
                stroke="#ffffff"
                strokeWidth={Math.max(2, d.aerial!.width / 400)}
                strokeDasharray={`${d.aerial!.width / 90} ${d.aerial!.width / 120}`}
                opacity="0.9"
              />
            ))}
            {(d.aerial.measured ?? []).map((m, i) => (
              <polygon
                key={`m${i}`}
                points={m.points}
                fill={m.kind === "bed" ? "rgba(180,120,40,0.25)" : "rgba(52,211,153,0.28)"}
                stroke={m.kind === "bed" ? "#b47828" : "#34d399"}
                strokeWidth={Math.max(1.5, d.aerial!.width / 500)}
              />
            ))}
          </svg>
          <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 text-[11px] font-medium">
            <span className="rounded-full bg-black/60 px-2.5 py-1 text-white">┄ parcel boundary</span>
            <span className="rounded-full bg-black/60 px-2.5 py-1 text-white">
              <span style={{ color: "#7ee2a0" }}>■</span> our measurement
            </span>
          </div>
        </div>
      ) : null}

      {/* Numbers */}
      {!d.is_bid ? (
        <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="col-span-2 rounded-2xl bg-brand p-5 text-white shadow-sm md:col-span-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-white/70">
              Contract value
            </div>
            <div className="mt-1 text-xl font-extrabold">
              {usd(d.annual_lo)}–{usd(d.annual_hi)}
              <span className="text-sm font-semibold text-white/80">/yr</span>
            </div>
            <div className="text-xs text-white/80">≈ {usd(d.monthly)}/mo</div>
          </div>
          <Stat label="Grounds" value={`${d.turf_sqft.toLocaleString()} sf`} />
          <Stat label="Parcel" value={`${d.acres.toFixed(1)} ac`} />
          <Stat label="Crew hrs / visit" value={`${d.crew_hours_per_visit}`} />
        </section>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Contacts, redacted */}
        <Card title="Decision contacts">
          <dl className="space-y-2.5">
            {d.contacts.slice(0, 6).map((c, i) => (
              <div key={i} className="flex gap-3 text-sm">
                <dt className="w-36 shrink-0 text-gray-500">{c.role}</dt>
                <dd className="font-medium text-gray-400">{mask(c.value)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-gray-400">
            Names, direct phones, emails, and mailing addresses — all included, tap-to-call.
          </p>
        </Card>

        {/* How to win */}
        <Card title="How to win it">
          <p className="text-sm font-semibold text-gray-800">{pb.angle}</p>
          <ol className="mt-3 space-y-2 text-sm leading-relaxed text-gray-700">
            {pb.steps.slice(0, 3).map((s, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-light text-[11px] font-bold text-brand">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {/* Letter, blurred */}
      <Card title="Ready-to-send intro letter" className="mt-6">
        <div className="relative">
          <pre className="max-h-56 select-none overflow-hidden whitespace-pre-wrap rounded-xl border border-gray-100 bg-gray-50 p-4 text-xs leading-relaxed text-gray-600 blur-[6px]">
            {d.intro_letter}
          </pre>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-white/95 px-4 py-2 text-xs font-semibold text-gray-700 shadow">
              Pre-written for this property — unlocks with the sheet
            </span>
          </div>
        </div>
      </Card>

      {/* Bid calculator, live */}
      {!d.is_bid ? (
        <Card title="Price it your way" className="mt-6">
          <p className="mb-3 text-xs text-gray-500">
            This calculator is live — drag it. Every sheet includes one tuned to the property.
          </p>
          <BidCalculator
            accent="#2f7d4f"
            turfSqft={d.turf_sqft}
            crewHours={d.crew_hours_per_visit}
            visitsPerYear={d.visits_per_year ?? 32}
            marketLo={d.annual_lo}
            marketHi={d.annual_hi}
          />
        </Card>
      ) : null}

      {/* CTA */}
      <div className="mt-8 rounded-2xl bg-brand p-6 text-center text-white shadow-sm">
        <div className="text-lg font-bold">Your first sheet is free.</div>
        <p className="mx-auto mt-1 max-w-md text-sm text-white/85">
          Create a profile and claim the full sheet — every ▮ filled in — for a live job near you.
          No card, no subscription.
        </p>
        <Link
          href="/buyers/signup"
          className="mt-4 inline-block rounded-lg bg-white px-6 py-2.5 text-sm font-bold text-brand hover:bg-gray-100"
        >
          See jobs near me →
        </Link>
      </div>
    </Shell>
  );
}

function Shell({ brand, children }: { brand: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link href="/">
            <Logo name={brand} />
          </Link>
          <Link href="/buyers/signup" className="text-sm font-semibold text-brand hover:underline">
            Get my free sheet →
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 pb-14 sm:px-6">{children}</main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</div>
      <div className="mt-1 text-xl font-extrabold text-gray-900">{value}</div>
    </div>
  );
}

function Card({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6 ${className ?? ""}`}>
      <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
