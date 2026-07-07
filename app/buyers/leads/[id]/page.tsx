import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, chatMessage, leadUnlock, property } from "@/lib/db/schema";
import { getDefaultCompany } from "@/lib/db/queries";
import { leadMaxBuyers } from "@/lib/leads/availability";
import type { Dossier } from "@/lib/leads/dossier";
import { currentBuyerId, sendChatMessage } from "../../actions";
import { Logo } from "@/components/Logo";
import { ChatWidget, type ChatMsg } from "@/components/ChatWidget";
import { BidCalculator } from "@/components/BidCalculator";

// The full job sheet — the product a buyer paid for. Renders the dossier
// SNAPSHOT from unlock time (aerial + vegetation mask + parcel outline
// included, so views never re-spend imagery quota). Ownership enforced.
export const dynamic = "force-dynamic";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default async function LeadSheet({ params }: { params: { id: string } }) {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");

  const [row] = await db
    .select({ unlock: leadUnlock, prop: property })
    .from(leadUnlock)
    .innerJoin(property, eq(leadUnlock.property_id, property.id))
    .where(and(eq(leadUnlock.id, params.id), eq(leadUnlock.buyer_id, buyerId!)))
    .limit(1);
  if (!row) notFound();

  const { unlock, prop } = row;
  const d = unlock.dossier as Dossier | null;
  const [me] = await db.select().from(buyer).where(eq(buyer.id, buyerId!)).limit(1);
  const co = await getDefaultCompany();
  const brand = co?.name ?? "Greenkeep";
  const accent = co?.brand_color || "#2f7d4f";
  const cap = leadMaxBuyers();

  const chat: ChatMsg[] = (
    await db
      .select()
      .from(chatMessage)
      .where(eq(chatMessage.buyer_id, buyerId!))
      .orderBy(asc(chatMessage.created_at))
      .limit(200)
  ).map((m) => ({
    id: m.id,
    sender: m.sender,
    body: m.body,
    at: m.created_at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
  }));

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
          <Logo name={brand} />
          <Link href="/buyers" className="text-sm text-gray-500 hover:text-gray-800">
            ← All leads
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {!d ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
            <div className="font-semibold">Your sheet is being prepared.</div>
            <p className="mt-1">
              {prop.name.replace(/ \(TABS [^)]+\)$/, "")} is yours — we&apos;re finalizing the full
              dossier and will email it shortly. Questions? Use the chat.
            </p>
          </div>
        ) : (
          <>
            {/* Title block */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  <span>{d.gk_ref}</span>
                  <span>·</span>
                  <span>prepared {d.prepared_at}</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold text-white`}
                    style={{ backgroundColor: unlock.kind === "exclusive" ? "#b45309" : accent }}
                  >
                    {unlock.kind === "exclusive" ? "EXCLUSIVELY YOURS" : `CAPPED AT ${cap} COMPANIES`}
                  </span>
                </div>
                <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-gray-900">{d.name}</h1>
                <p className="mt-1 text-sm text-gray-600">
                  {[d.address, d.city, d.zip].filter(Boolean).join(", ")}
                  {d.county ? ` · ${d.county} County` : ""}
                </p>
              </div>
            </div>

            {/* Aerial with measurement overlay */}
            <div className="relative mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-gray-900 shadow-sm">
              {d.aerial ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={d.aerial.image} alt={`Aerial of ${d.name}`} className="w-full" />
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
                  </svg>
                  <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 text-[11px] font-medium">
                    <span className="rounded-full bg-black/60 px-2.5 py-1 text-white">
                      ┄ parcel boundary
                    </span>
                    {d.aerial.mask ? (
                      <span className="rounded-full bg-black/60 px-2.5 py-1 text-white">
                        <span style={{ color: "#7ee2a0" }}>■</span> measured turf
                      </span>
                    ) : (
                      <span className="rounded-full bg-black/60 px-2.5 py-1 text-white">
                        under construction — turf projected from parcel geometry
                      </span>
                    )}
                  </div>
                </>
              ) : prop.lat != null && prop.lng != null ? (
                // Older unlocks (pre-snapshot): live preview fallback.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/property-preview?lng=${prop.lng}&lat=${prop.lat}&zoom=16`}
                  alt={`Aerial view of ${d.name}`}
                  className="aspect-video w-full object-cover"
                />
              ) : null}
            </div>

            {/* Numbers */}
            <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
              <div
                className="col-span-2 rounded-2xl p-5 text-white shadow-sm md:col-span-2"
                style={{ backgroundColor: accent }}
              >
                <div className="text-[11px] font-semibold uppercase tracking-wider text-white/70">
                  Contract value
                </div>
                <div className="mt-1 text-2xl font-extrabold">
                  {usd(d.annual_lo)}–{usd(d.annual_hi)}
                  <span className="text-base font-semibold text-white/80">/yr</span>
                </div>
                <div className="text-sm text-white/80">≈ {usd(d.monthly)}/mo · every year</div>
              </div>
              <Stat label={d.projected ? "Turf (projected)" : "Turf (measured)"} value={`${d.turf_sqft.toLocaleString()} sf`} />
              <Stat label="Parcel" value={`${d.acres.toFixed(1)} ac`} />
              <Stat label="Crew hrs / visit" value={`${d.crew_hours_per_visit}`} sub={`${d.visits_per_year ?? 32} visits/yr`} />
            </section>

            {/* Two-column detail */}
            <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-6">
                <Card title="The project">
                  <dl className="space-y-2">
                    <Row k="Project value" v={d.project_cost} strong />
                    <Row k="Work type" v={d.work_type} />
                    <Row k="Est. start" v={d.est_start} />
                    <Row k="Est. completion" v={d.est_completion} />
                    <Row k="Engage owner by" v={d.engage_by} accent={accent} />
                  </dl>
                  {d.scope ? <p className="mt-4 text-sm leading-relaxed text-gray-600">{d.scope}</p> : null}
                </Card>

                <Card title="Decision contacts">
                  {d.contacts.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      No published contacts — use the playbook to reach the owner.
                    </p>
                  ) : (
                    <dl className="space-y-2.5">
                      {d.contacts.map((c, i) => (
                        <div key={i} className="flex gap-3 text-sm">
                          <dt className="w-36 shrink-0 text-gray-500">{c.role}</dt>
                          <dd className="font-medium text-gray-900">{c.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </Card>

                <Card title="Price it your way" eyebrow="Bid calculator">
                  <BidCalculator
                    accent={accent}
                    turfSqft={d.turf_sqft}
                    crewHours={d.crew_hours_per_visit}
                    visitsPerYear={d.visits_per_year ?? 32}
                    marketLo={d.annual_lo}
                    marketHi={d.annual_hi}
                  />
                </Card>
              </div>

              <div className="space-y-6">
                <Card title="How to win it">
                  <p className="text-sm leading-relaxed text-gray-700">{d.guidance}</p>
                  <div className="mt-4 rounded-xl bg-gray-50 p-4 text-sm leading-relaxed text-gray-700">
                    <span className="font-semibold">Route intelligence:</span> {d.route_intel}
                  </div>
                </Card>

                <Card title="Ready-to-send intro letter">
                  <p className="mb-3 text-xs text-gray-400">
                    Fill in the bracketed fields and send on your letterhead.
                  </p>
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-gray-100 bg-gray-50 p-4 text-xs leading-relaxed text-gray-700">
                    {d.intro_letter}
                  </pre>
                </Card>
              </div>
            </div>

            <p className="mt-8 text-center text-xs text-gray-400">
              Prepared for {me?.company_name ?? "your company"} by {brand}.{" "}
              {unlock.kind === "exclusive"
                ? "This job is exclusively yours — we will never sell it to anyone else."
                : `We sell each job to no more than ${cap} companies.`}{" "}
              Do not redistribute.
            </p>
          </>
        )}
      </main>

      <ChatWidget mode="buyer" messages={chat} sendAction={sendChatMessage} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-gray-900">{value}</div>
      {sub ? <div className="text-xs text-gray-400">{sub}</div> : null}
    </div>
  );
}

function Card({ title, eyebrow, children }: { title: string; eyebrow?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      {eyebrow ? (
        <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">{eyebrow}</div>
      ) : null}
      <h2 className={`text-sm font-bold uppercase tracking-wide text-gray-700 ${eyebrow ? "mt-0.5" : ""}`}>
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ k, v, strong, accent }: { k: string; v: string | null; strong?: boolean; accent?: string }) {
  if (!v) return null;
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-36 shrink-0 text-gray-500">{k}</dt>
      <dd
        className={strong || accent ? "font-bold text-gray-900" : "text-gray-900"}
        style={accent ? { color: accent } : undefined}
      >
        {v}
      </dd>
    </div>
  );
}
