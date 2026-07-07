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

// Full job sheet for an unlocked lead. Renders the dossier SNAPSHOT taken at
// unlock time — the buyer keeps exactly what they bought; no API quota is
// re-spent on views. Ownership is enforced (unlock must belong to the session
// buyer).
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
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Logo name={brand} />
          <Link href="/buyers" className="text-sm text-gray-500 hover:text-gray-800">
            ← All leads
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        {!d ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
            <div className="font-medium">Your sheet is being prepared.</div>
            <p className="mt-1">
              {prop.name.replace(/ \(TABS [^)]+\)$/, "")} is yours — we&apos;re finalizing the full
              dossier and will email it shortly. Questions? Just reply to any of our emails.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  {d.gk_ref} · prepared {d.prepared_at} ·{" "}
                  {unlock.kind === "exclusive"
                    ? "exclusive to you"
                    : `capped at ${leadMaxBuyers()} companies`}
                </div>
                <h1 className="mt-1 text-2xl font-semibold">{d.name}</h1>
                <p className="mt-1 text-sm text-gray-600">
                  {[d.address, d.city, d.zip].filter(Boolean).join(", ")}
                  {d.county ? ` · ${d.county} County` : ""}
                </p>
              </div>
            </div>

            {prop.lat != null && prop.lng != null ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/property-preview?lng=${prop.lng}&lat=${prop.lat}&zoom=17`}
                alt={`Aerial view of ${d.name}`}
                className="mt-5 aspect-square w-full max-w-md rounded-xl border border-gray-200 object-cover"
              />
            ) : null}

            {/* Numbers */}
            <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Contract value" value={`${usd(d.annual_lo)}–${usd(d.annual_hi)}/yr`} wide />
              <Stat label="Monthly" value={`${usd(d.monthly)}/mo`} />
              <Stat
                label={d.projected ? "Turf (projected)" : "Turf (measured)"}
                value={`${d.turf_sqft.toLocaleString()} sf`}
              />
              <Stat label="Parcel" value={`${d.acres.toFixed(1)} ac`} />
              <Stat label="Crew hrs / visit" value={String(d.crew_hours_per_visit)} />
            </section>

            {/* Project */}
            <Card title="The project">
              <Row k="Project value" v={d.project_cost} />
              <Row k="Work type" v={d.work_type} />
              <Row k="Est. start" v={d.est_start} />
              <Row k="Est. completion" v={d.est_completion} />
              <Row k="Engage by" v={d.engage_by} strong />
              {d.scope ? <p className="mt-3 text-sm text-gray-600">{d.scope}</p> : null}
            </Card>

            {/* Contacts */}
            <Card title="Decision contacts">
              {d.contacts.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No published contacts — use the playbook below to reach the owner.
                </p>
              ) : (
                <dl className="space-y-2">
                  {d.contacts.map((c, i) => (
                    <div key={i} className="flex gap-3 text-sm">
                      <dt className="w-40 shrink-0 text-gray-500">{c.role}</dt>
                      <dd className="text-gray-900">{c.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Card>

            {/* Playbook */}
            <Card title="How to win it">
              <p className="text-sm text-gray-700">{d.guidance}</p>
              <p className="mt-3 text-sm text-gray-700">{d.route_intel}</p>
            </Card>

            {/* Intro letter */}
            <Card title="Ready-to-send intro letter">
              <p className="mb-3 text-xs text-gray-400">
                Fill in the bracketed fields and send on your letterhead.
              </p>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-xs leading-relaxed text-gray-700">
                {d.intro_letter}
              </pre>
            </Card>

            <p className="mt-8 text-xs text-gray-400">
              Prepared for {me?.company_name ?? "your company"} by {brand}.{" "}
              {unlock.kind === "exclusive"
                ? "This job is exclusively yours — we will never sell it to anyone else."
                : `We sell each job to no more than ${leadMaxBuyers()} companies.`}{" "}
              Do not redistribute.
            </p>
          </>
        )}
      </main>

      <ChatWidget mode="buyer" messages={chat} sendAction={sendChatMessage} />
    </div>
  );
}

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-4 ${wide ? "col-span-2" : ""}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Row({ k, v, strong }: { k: string; v: string | null; strong?: boolean }) {
  if (!v) return null;
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-40 shrink-0 text-gray-500">{k}</dt>
      <dd className={strong ? "font-semibold text-gray-900" : "text-gray-900"}>{v}</dd>
    </div>
  );
}
