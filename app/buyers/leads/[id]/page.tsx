import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, chatMessage, leadUnlock, property } from "@/lib/db/schema";
import { getDefaultCompany } from "@/lib/db/queries";
import { leadMaxBuyers } from "@/lib/leads/availability";
import type { Metadata } from "next";
import type { Dossier } from "@/lib/leads/dossier";
import { personalizeLetter, profileComplete } from "@/lib/leads/personalize";
import { addLeadNote, currentBuyerId, sendChatMessage, setLeadStatus, startPostcardCheckout } from "../../actions";
import { leadActivity, postcard } from "@/lib/db/schema";
import { postcardPriceCents } from "@/lib/integrations/stripe";
import { LogoMark } from "@/components/Logo";
import { Logo } from "@/components/Logo";
import { ChatWidget, type ChatMsg } from "@/components/ChatWidget";
import { BidCalculator } from "@/components/BidCalculator";
import { CopyLetter } from "@/components/CopyLetter";
import { OutreachTracker } from "@/components/OutreachTracker";

// The full job sheet — the product a buyer paid for. Renders the dossier
// SNAPSHOT from unlock time (aerial + vegetation mask + parcel outline
// included, so views never re-spend imagery quota). Ownership enforced.
export const dynamic = "force-dynamic";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const buyerId = await currentBuyerId();
  if (!buyerId) return { title: "Greenkeep job sheet" };
  const [row] = await db
    .select({ dossier: leadUnlock.dossier })
    .from(leadUnlock)
    .where(and(eq(leadUnlock.id, params.id), eq(leadUnlock.buyer_id, buyerId)))
    .limit(1);
  const name = (row?.dossier as Dossier | null)?.name;
  return { title: name ? `Greenkeep · ${name} — job sheet` : "Greenkeep job sheet" };
}

export default async function LeadSheet({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { mailed?: string; canceled?: string; perr?: string };
}) {
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
  // The intro letter is personalized from the buyer's LIVE profile so editing
  // their profile updates every letter they hold.
  const letter = d?.intro_letter ? personalizeLetter(d.intro_letter, me ?? {}) : "";
  const letterReady = profileComplete(me ?? {});

  const activity = await db
    .select()
    .from(leadActivity)
    .where(eq(leadActivity.unlock_id, unlock.id))
    .orderBy(desc(leadActivity.created_at))
    .limit(50);

  // Postcard state (already mailed?) + who it'd go to.
  const [mailed] = await db
    .select()
    .from(postcard)
    .where(and(eq(postcard.unlock_id, unlock.id), eq(postcard.status, "created")))
    .orderBy(desc(postcard.created_at))
    .limit(1);
  const ownerName = d?.contacts.find((c) => c.role === "Owner")?.value ?? null;
  const ownerMail = d?.contacts.find((c) => c.role.startsWith("Owner mail"))?.value ?? null;
  const postcardPrice = Math.round(postcardPriceCents() / 100);
  const canMail = Boolean(ownerMail && (me?.address && me?.city));

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
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
          <Logo name={brand} />
          <div className="flex items-center gap-4">
            <a
              href={`/buyers/leads/${unlock.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              View / download PDF
            </a>
            <Link href="/buyers" className="text-sm text-gray-500 hover:text-gray-800">
              ← All leads
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* Print-only branded masthead (this is what a buyer prints for the truck). */}
        <div className="print-brand-header mb-6 hidden items-center justify-between border-b-2 pb-4" style={{ borderColor: accent }}>
          <div className="flex items-center gap-2">
            <LogoMark size={26} color={accent} />
            <span className="text-lg font-bold tracking-tight">{brand}</span>
            <span className="ml-2 text-xs uppercase tracking-widest text-gray-400">Job intelligence sheet</span>
          </div>
          <div className="text-right text-[11px] text-gray-500">
            {d?.gk_ref ? <div className="font-semibold text-gray-700">{d.gk_ref}</div> : null}
            <div>Prepared for {me?.company_name ?? "your company"}</div>
            {d?.prepared_at ? <div>{d.prepared_at}</div> : null}
          </div>
        </div>

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
                  {d.drive ? (
                    <span className="font-semibold" style={{ color: accent }}>
                      {" "}· {d.drive.minutes} min drive from your office ({d.drive.miles} mi)
                    </span>
                  ) : null}
                </p>
              </div>
            </div>

            {/* Outreach tracker — the buyer's pipeline on this lead */}
            <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm print:hidden">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">Your outreach</h2>
                <span className="text-xs text-gray-400">Track this lead from first touch to won.</span>
              </div>
              <div className="mt-4">
                <OutreachTracker unlockId={unlock.id} status={unlock.outreach_status} accent={accent} onSet={setLeadStatus} />
              </div>

              <form action={addLeadNote.bind(null, unlock.id)} className="mt-4 flex gap-2">
                <input
                  name="note"
                  maxLength={1000}
                  placeholder="Add a note — who you called, next step…"
                  className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
                <button className="rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                  Log
                </button>
              </form>

              {activity.length > 0 ? (
                <ul className="mt-4 space-y-2 border-t border-gray-100 pt-4">
                  {activity.map((a) => (
                    <li key={a.id} className="flex gap-3 text-sm">
                      <span className="mt-0.5 text-[11px] text-gray-400">
                        {a.created_at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                      <span className={a.kind === "status" ? "font-medium text-gray-700" : "text-gray-600"}>
                        {a.kind === "status" ? "" : "📝 "}
                        {a.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            {/* Mail the owner a postcard (Lob) */}
            <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm print:hidden">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">Mail the owner</h2>
                <span className="text-xs text-gray-400">Printed & mailed by us — from you.</span>
              </div>

              {searchParams.mailed ? (
                <p className="mt-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                  Payment received — your postcard is being sent to print. It&apos;ll show below once confirmed.
                </p>
              ) : null}
              {searchParams.perr ? (
                <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{searchParams.perr}</p>
              ) : null}

              {mailed ? (
                <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                  <div className="font-semibold">Postcard mailed ✓</div>
                  <div className="mt-0.5">
                    To {mailed.to_name}
                    {mailed.expected_delivery ? ` — arrives around ${mailed.expected_delivery}` : ""}.
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <p className="text-sm text-gray-600">
                    Send a branded postcard (your logo, your return address) straight to the owner&apos;s
                    mailbox — a physical touch most competitors skip. Prints and mails within one
                    business day.
                  </p>
                  <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm">
                    <div className="text-gray-500">Would mail to:</div>
                    <div className="font-medium text-gray-900">{ownerName ?? "the owner"}</div>
                    <div className="text-gray-600">{ownerMail ?? "No mailing address on file for this owner."}</div>
                  </div>
                  {canMail ? (
                    <form action={startPostcardCheckout.bind(null, unlock.id)} className="mt-3">
                      <button className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">
                        Mail this owner — ${postcardPrice}
                      </button>
                    </form>
                  ) : (
                    <p className="mt-3 text-xs text-amber-700">
                      {!ownerMail
                        ? "We don't have a mailing address for this owner, so a postcard can't be sent."
                        : (
                          <>
                            Add your office address in your{" "}
                            <Link href="/buyers/profile" className="font-semibold underline">
                              profile
                            </Link>{" "}
                            first — it&apos;s the postcard&apos;s return address.
                          </>
                        )}
                    </p>
                  )}
                  {!me?.logo_url ? (
                    <p className="mt-2 text-xs text-gray-400">
                      Tip: add your logo in your{" "}
                      <Link href="/buyers/profile" className="underline">profile</Link> so it prints on the card.
                    </p>
                  ) : null}
                </div>
              )}
            </section>

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
                        <span style={{ color: "#7ee2a0" }}>■</span>{" "}
                        {d.projected
                          ? `vegetation detected today${d.detected_sqft ? ` (${d.detected_sqft.toLocaleString()} sf)` : ""}`
                          : "measured turf"}
                      </span>
                    ) : null}
                    {d.projected ? (
                      <span className="rounded-full bg-black/60 px-2.5 py-1 text-white">
                        site in buildout — full grounds projected at {d.turf_sqft.toLocaleString()} sf on completion
                      </span>
                    ) : null}
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
              <Stat
                label={d.projected ? "Turf (projected)" : "Turf (measured)"}
                value={`${d.turf_sqft.toLocaleString()} sf`}
                sub={d.projected && d.detected_sqft ? `${d.detected_sqft.toLocaleString()} sf visible today` : undefined}
              />
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
                    driveMinutes={d.drive ? Math.max(10, Math.round((d.drive.minutes * 2) / 5) * 5) : undefined}
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
                  {letterReady ? (
                    <p className="mb-3 text-xs text-gray-500">
                      Filled in from your profile — copy and send on your letterhead.
                    </p>
                  ) : (
                    <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 print:hidden">
                      This letter fills in automatically from your{" "}
                      <Link href="/buyers/profile" className="font-semibold underline">
                        company profile
                      </Link>{" "}
                      — add your name, phone, and email once and every lead comes pre-addressed.
                    </p>
                  )}
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-gray-100 bg-gray-50 p-4 text-xs leading-relaxed text-gray-700">
                    {letter}
                  </pre>
                  <div className="mt-3 print:hidden">
                    <CopyLetter text={letter} accent={accent} />
                  </div>
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
    <section className="print-avoid-break rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
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
