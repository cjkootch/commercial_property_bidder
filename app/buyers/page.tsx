import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, desc, eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, chatMessage, leadUnlock, property } from "@/lib/db/schema";
import { getDefaultCompany } from "@/lib/db/queries";
import { exclusivePriceCents, leadPriceCents } from "@/lib/integrations/stripe";
import { leadMaxBuyers } from "@/lib/leads/availability";
import { haversineMiles } from "@/lib/sourcing/criteria";
import { buyerLogout, claimFreeLead, currentBuyerId, sendChatMessage, startCheckout, toggleNotifications } from "./actions";
import { Logo } from "@/components/Logo";
import { ChatWidget, type ChatMsg } from "@/components/ChatWidget";

// Buyer dashboard: unlocked leads (theirs forever), open opportunities in
// their area (teaser fields only — one Stripe click to unlock, or account
// credit applied automatically), and the notifications toggle. Kept
// deliberately simple.
export const dynamic = "force-dynamic";
// Credit redemptions in startCheckout build the dossier snapshot inline.
export const maxDuration = 60;

const note = (notes: string | null, re: RegExp) => notes?.match(re)?.[1]?.trim() ?? null;

export default async function BuyerDashboard({
  searchParams,
}: {
  searchParams: { unlocked?: string; canceled?: string; err?: string };
}) {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const [me] = await db.select().from(buyer).where(eq(buyer.id, buyerId!)).limit(1);
  if (!me) redirect("/buyers/login");

  const co = await getDefaultCompany();
  const brand = co?.name ?? "Greenkeep";
  const price = Math.round(leadPriceCents() / 100);
  const exclusivePrice = Math.round(exclusivePriceCents() / 100);
  const cap = leadMaxBuyers();

  const mine = await db
    .select({ unlock: leadUnlock, prop: property })
    .from(leadUnlock)
    .innerJoin(property, eq(leadUnlock.property_id, property.id))
    .where(eq(leadUnlock.buyer_id, me.id))
    .orderBy(desc(leadUnlock.created_at));
  // "First sheet free" — organic signups claim it from here.
  const freeAvailable = !mine.some(({ unlock }) => unlock.kind === "free");

  const chat: ChatMsg[] = (
    await db
      .select()
      .from(chatMessage)
      .where(eq(chatMessage.buyer_id, me.id))
      .orderBy(asc(chatMessage.created_at))
      .limit(200)
  ).map((m) => ({
    id: m.id,
    sender: m.sender,
    body: m.body,
    at: m.created_at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
  }));

  // Open opportunities: permit leads with shared spots left (cap disclosed —
  // that's the scarcity promise). Teaser fields only (value/type/timing/city +
  // distance) — never the address. Excludes leads this buyer already holds and
  // anything not yet sellable (no parcel measurement).
  const open = await db
    .select()
    .from(property)
    .where(like(property.name, "%(TABS %"))
    .orderBy(desc(property.created_at));
  const allUnlocks = await db
    .select({ pid: leadUnlock.property_id, bid: leadUnlock.buyer_id, kind: leadUnlock.kind })
    .from(leadUnlock);
  const byProp = new Map<string, { count: number; exclusive: boolean; mine: boolean }>();
  for (const u of allUnlocks) {
    const e = byProp.get(u.pid) ?? { count: 0, exclusive: false, mine: false };
    e.count++;
    if (u.kind === "exclusive") e.exclusive = true;
    if (u.bid === me.id) e.mine = true;
    byProp.set(u.pid, e);
  }
  const available = open
    .filter((p) => {
      const e = byProp.get(p.id);
      return (
        p.lead_exported_at == null &&
        p.parcel_geojson != null &&
        !e?.exclusive &&
        !e?.mine &&
        (e?.count ?? 0) < cap
      );
    })
    .map((p) => {
      const teaser = p.lead_teaser as { annual_lo?: number; annual_hi?: number; turf_sqft?: number } | null;
      return {
        p,
        teaser,
        cost: note(p.notes, /est\. cost (\$[\d,]+)/),
        workType: note(p.notes, /: ([^,]+), est\. cost/),
        start: note(p.notes, /Est\. start ([\d-]+)/),
        spotsLeft: cap - (byProp.get(p.id)?.count ?? 0),
        exclusiveOpen: (byProp.get(p.id)?.count ?? 0) === 0,
        miles:
          me.lat != null && me.lng != null && p.lat != null && p.lng != null
            ? Math.max(1, Math.round(haversineMiles([me.lng, me.lat], [p.lng, p.lat])))
            : null,
      };
    })
    .sort((a, b) => (b.teaser?.annual_hi ?? 0) / ((b.miles ?? 30) + 20) - (a.teaser?.annual_hi ?? 0) / ((a.miles ?? 30) + 20))
    .slice(0, 12);
  const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Logo name={brand} />
          <form action={buyerLogout}>
            <button className="text-sm text-gray-500 hover:text-gray-800">Sign out</button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Your job leads</h1>
            <p className="mt-1 text-sm text-gray-500">
              {me.company_name} · {me.email}
              {me.city ? ` · ${me.city}` : ""}
            </p>
          </div>
          <Link
            href="/buyers/residential"
            className="rounded-lg bg-brand/10 px-4 py-2 text-sm font-semibold text-brand transition hover:bg-brand/20"
          >
            Residential leads
          </Link>
        </div>

        {searchParams.unlocked ? (
          <p className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            Payment received — your lead unlocks the moment the payment confirms (usually seconds).
            Refresh if it isn&apos;t below yet.
          </p>
        ) : null}
        {searchParams.canceled ? (
          <p className="mt-4 rounded-md border border-gray-200 bg-white p-3 text-sm text-gray-600">
            Checkout canceled — the lead is still open below.
          </p>
        ) : null}
        {searchParams.err ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {searchParams.err}
          </p>
        ) : null}
        {me.credit_cents > 0 ? (
          <p className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            You have a <strong>${Math.round(me.credit_cents / 100).toLocaleString()} credit</strong> —
            it applies automatically when you unlock any job below. No card needed.
          </p>
        ) : null}

        {/* ---- Unlocked leads -------------------------------------------- */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Unlocked — yours
          </h2>
          {mine.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
              Nothing unlocked yet. Claim a job below and the full sheet — location, contacts,
              measurement, bid window — appears here.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {mine.map(({ unlock, prop }) => {
                const d = unlock.dossier as { annual_lo?: number; annual_hi?: number } | null;
                return (
                  <Link
                    key={unlock.id}
                    href={`/buyers/leads/${unlock.id}`}
                    className="block rounded-xl border border-gray-200 bg-white p-5 hover:border-brand"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-medium text-gray-900">
                          {prop.name.replace(/ \(TABS [^)]+\)$/, "")}
                        </div>
                        <div className="mt-1 text-sm text-gray-500">
                          {prop.city ?? ""}
                          {d?.annual_lo
                            ? ` · est. $${d.annual_lo.toLocaleString()}–$${(d.annual_hi ?? d.annual_lo).toLocaleString()}/yr`
                            : ""}
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          unlock.kind === "free"
                            ? "bg-green-100 text-green-800"
                            : unlock.kind === "exclusive"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-brand/10 text-brand"
                        }`}
                      >
                        {unlock.kind === "free"
                          ? "Free claim"
                          : unlock.kind === "exclusive"
                            ? "Exclusive"
                            : "Purchased"}
                      </span>
                    </div>
                    <div className="mt-2 text-sm font-medium text-brand">View full sheet →</div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* ---- Open opportunities ---------------------------------------- */}
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Open in your area
          </h2>
          <p className="mt-1 text-xs text-gray-400">
            Every job is capped at {cap} companies — ever. Or lock one down as an exclusive and
            nobody else gets it. If a job sells out before your payment settles, your payment
            instantly becomes account credit for any other job — it never disappears.
          </p>
          {available.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
              Nothing open right now. We&apos;ll email you when a new job lands
              {me.city ? ` near ${me.city}` : " in your area"}.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {available.map(({ p, teaser, cost, workType, start, miles, spotsLeft, exclusiveOpen }) => (
                <div
                  key={p.id}
                  className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:shadow-md"
                >
                  <div className="flex flex-wrap items-stretch justify-between gap-x-6 gap-y-4 p-6">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {teaser?.annual_lo ? (
                          <span className="text-2xl font-extrabold tracking-tight text-gray-900">
                            {usd(teaser.annual_lo)}–{usd(teaser.annual_hi ?? teaser.annual_lo)}
                            <span className="text-sm font-semibold text-gray-400">/yr</span>
                          </span>
                        ) : (
                          <span className="text-2xl font-extrabold tracking-tight text-gray-900">
                            {cost ?? "Large"} project
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                            spotsLeft === 1
                              ? "bg-amber-100 text-amber-800"
                              : "bg-brand/10 text-brand"
                          }`}
                        >
                          {spotsLeft === 1 ? "LAST SPOT" : `${spotsLeft} of ${cap} spots left`}
                        </span>
                      </div>
                      <div className="mt-1 text-sm font-medium text-gray-700">
                        Grounds contract behind a {cost ?? "major"}{" "}
                        {(workType ?? "commercial").toLowerCase()} project
                        {p.city ? ` — ${p.city} area` : ""}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-gray-500">
                        {miles != null ? (
                          <span className="font-semibold text-brand">~{miles} mi from your office</span>
                        ) : null}
                        {start ? <span>breaks ground ~{start}</span> : <span>in development</span>}
                        {teaser?.turf_sqft ? (
                          <span>{teaser.turf_sqft.toLocaleString()} sf of grounds</span>
                        ) : null}
                      </div>
                      <div className="mt-2 text-xs text-gray-400">
                        Sheet includes the exact address, aerial measurement, decision contacts,
                        bid window, and intro letter.
                      </div>
                    </div>
                    <div className="flex w-full flex-col justify-center gap-2 sm:w-56">
                      {freeAvailable ? (
                        <form action={claimFreeLead.bind(null, p.id)}>
                          <button className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark">
                            Claim free — first sheet on us
                          </button>
                        </form>
                      ) : (
                        <form action={startCheckout.bind(null, p.id, "paid")}>
                          <button className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark">
                            Unlock the sheet — ${price}
                          </button>
                        </form>
                      )}
                      {exclusiveOpen ? (
                        <form action={startCheckout.bind(null, p.id, "exclusive")}>
                          <button className="w-full rounded-lg border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50">
                            Lock it down — ${exclusivePrice} exclusive
                          </button>
                        </form>
                      ) : null}
                      {teaser?.annual_lo && !freeAvailable ? (
                        <p className="text-center text-[11px] text-gray-400">
                          ${price} for a {usd(teaser.annual_lo)}+/yr contract lead
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ---- Notifications ---------------------------------------------- */}
        <section className="mt-10 rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-gray-900">New-job alerts</div>
              <div className="mt-0.5 text-sm text-gray-500">
                {me.notify
                  ? "On — we'll email you when a new job opens near you."
                  : "Off — you won't hear about new jobs."}
              </div>
            </div>
            <form action={toggleNotifications.bind(null, !me.notify)}>
              <button className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Turn {me.notify ? "off" : "on"}
              </button>
            </form>
          </div>
        </section>
      </main>

      <ChatWidget mode="buyer" messages={chat} sendAction={sendChatMessage} />
    </div>
  );
}
