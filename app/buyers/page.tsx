import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, chatMessage, leadUnlock, postcard, property, prospect } from "@/lib/db/schema";
import { getDefaultCompany } from "@/lib/db/queries";
import { leadTierFor, type LeadTier } from "@/lib/leads/pricing-tiers";
import { leadMaxBuyers } from "@/lib/leads/availability";
import type { FreeClaimVerdict } from "@/lib/leads/allocation";
import {
  displayName,
  freeVerdict,
  loadMarketLeads,
  marketFreeContext,
  nextBestFor,
  type LeadKind,
  type MarketLead,
} from "@/lib/leads/market";
import {
  asTrade,
  TRADES,
  tradeValueInput,
  type Trade,
  type TradeValueEstimate,
} from "@/lib/leads/trades";
import {
  FIRST_LOOK_HOURS,
  firstLookActive,
  firstLookPriceCents,
  hoursUntilPublic,
  inFirstLookWindow,
} from "@/lib/leads/subscription";
import { haversineMiles } from "@/lib/sourcing/criteria";
import {
  buyerLogout,
  claimFreeLead,
  currentBuyerId,
  markAlertsSeen,
  sendChatMessage,
  startCheckout,
  startFirstLookCheckout,
  toggleNotifications,
} from "./actions";
import { Logo } from "@/components/Logo";
import { ChatWidget, type ChatMsg } from "@/components/ChatWidget";
import { profileComplete } from "@/lib/leads/personalize";

// Buyer dashboard: unlocked leads (theirs forever), open opportunities in
// their area (teaser fields only — one Stripe click to unlock, or account
// credit applied automatically), and the notifications toggle. Kept
// deliberately simple.
export const dynamic = "force-dynamic";
// Credit redemptions in startCheckout build the dossier snapshot inline.
export const maxDuration = 60;

const note = (notes: string | null, re: RegExp) => notes?.match(re)?.[1]?.trim() ?? null;

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  letter_sent: "Letter sent",
  postcard_sent: "Postcard mailed",
  contacted: "Contacted",
  bidding: "Bidding",
  won: "Won 🏆",
  lost: "Lost",
};
const STATUS_STYLE: Record<string, string> = {
  new: "bg-gray-100 text-gray-500",
  letter_sent: "bg-blue-50 text-blue-700",
  postcard_sent: "bg-blue-50 text-blue-700",
  contacted: "bg-indigo-50 text-indigo-700",
  bidding: "bg-amber-100 text-amber-800",
  won: "bg-green-100 text-green-800",
  lost: "bg-gray-100 text-gray-400",
};

export default async function BuyerDashboard({
  searchParams,
}: {
  searchParams: { unlocked?: string; canceled?: string; err?: string; offer?: string; firstlook?: string };
}) {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const [me] = await db.select().from(buyer).where(eq(buyer.id, buyerId!)).limit(1);
  if (!me) redirect("/buyers/login");

  const co = await getDefaultCompany();
  const brand = co?.name ?? "Greenkeep";
  const accent = co?.brand_color || "#2f7d4f";
  const cap = leadMaxBuyers();

  const mine = await db
    .select({ unlock: leadUnlock, prop: property })
    .from(leadUnlock)
    .innerJoin(property, eq(leadUnlock.property_id, property.id))
    .where(eq(leadUnlock.buyer_id, me.id))
    .orderBy(desc(leadUnlock.created_at));
  // "First sheet free" — organic signups claim it from here.
  const freeAvailable = !mine.some(({ unlock }) => unlock.kind === "free");

  // Self-serve prospecting summary + alert sources (skip heavy jsonb columns).
  const myProspects = await db
    .select({
      id: prospect.id,
      name: prospect.name,
      address: prospect.address,
      status: prospect.status,
      views: prospect.view_count,
      last_viewed_at: prospect.last_viewed_at,
    })
    .from(prospect)
    .where(eq(prospect.buyer_id, me.id));
  const prospectCount = myProspects.length;
  const prospectMailed = myProspects.filter((p) => p.status === "mailed" || p.status === "viewed").length;
  const prospectViews = myProspects.reduce((s, p) => s + (p.views ?? 0), 0);

  const myPostcards = await db
    .select({
      id: postcard.id,
      to_name: postcard.to_name,
      expected_delivery: postcard.expected_delivery,
      status: postcard.status,
      unlock_id: postcard.unlock_id,
      prospect_id: postcard.prospect_id,
      created_at: postcard.created_at,
    })
    .from(postcard)
    .where(eq(postcard.buyer_id, me.id))
    .orderBy(desc(postcard.created_at))
    .limit(10);

  const chatRows = await db
    .select()
    .from(chatMessage)
    .where(eq(chatMessage.buyer_id, me.id))
    .orderBy(asc(chatMessage.created_at))
    .limit(200);
  const chat: ChatMsg[] = chatRows.map((m) => ({
    id: m.id,
    sender: m.sender,
    body: m.body,
    at: m.created_at.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
  }));

  // Open opportunities: every feed's leads with shared spots left (cap
  // disclosed — that's the scarcity promise). Teaser fields only (value/type/
  // timing/city + distance) — never the address. The shelf itself comes from
  // lib/leads/market so the dashboard, the claim actions, and the operator's
  // offer blast all agree on what's open and what may go free.
  const myTrade = asTrade(me.trade);
  const market = await loadMarketLeads(myTrade);
  const freeCtx = marketFreeContext(market);
  const toItem = (l: MarketLead): LeadItem => {
    const { p, teaser, kind } = l;
    const start = note(p.notes, /Est\. start ([\d-]+)/);
    return {
      p,
      teaser,
      trade: myTrade,
      // This trade's own contract-value estimate (landscaping = the teaser).
      value: TRADES[myTrade].estimateValue(tradeValueInput(p, kind)),
      kind,
      cost: note(p.notes, /est\. cost (\$[\d,]+)/),
      workType: note(p.notes, /: ([^,]+), est\. cost/),
      timing:
        kind === "transfer"
          ? `changed owners ${note(p.notes, /HCAD transfer ([\d-]+)/) ?? "recently"}`
          : kind === "opening"
            ? `opens ~${note(p.notes, /Opens ([\d-]+)/) ?? "soon"}`
            : kind === "violation"
              ? `cited ${note(p.notes, /311 case \S+ \(([\d-]+)\)/) ?? "recently"} — needs service now`
              : kind === "distress"
                ? (note(p.notes, /Tax sale scheduled ([\d-]+)/)
                    ? `tax sale ${note(p.notes, /Tax sale scheduled ([\d-]+)/)} — forced-action window`
                    : "in the tax-sale pipeline — owner must act")
                : kind === "rfp"
                  ? `bids close ${note(p.notes, /Bids close ([\d-]+)/) ?? "soon"}`
                  : start
                    ? `breaks ground ~${start}`
                    : "in development",
      spotsLeft: l.spotsLeft,
      exclusiveOpen: l.exclusiveOpen,
      free: freeVerdict(l, freeCtx),
      // Sheet price keys off THIS trade's value estimate — a $466k/yr
      // cleaning lead is premium even where the turf teaser is modest.
      priceTier: leadTierFor(
        TRADES[myTrade].estimateValue(tradeValueInput(p, kind))?.annualHi ?? null,
        kind
      ),
      rank: l.rank,
      miles:
        me.lat != null && me.lng != null && p.lat != null && p.lng != null
          ? Math.max(1, Math.round(haversineMiles([me.lng, me.lat], [p.lng, p.lat])))
          : null,
    };
  };
  // First Look: brand-new leads live on members' shelves only during the
  // early-access window. Display-level gate — operator-sent links (campaign
  // claims, waterfall offers) keep working for everyone.
  const hasFirstLook = firstLookActive(me);
  const allEligible = market.filter((l) => !l.holders.has(me.id)).map(toItem);
  // Locked count = only jobs the member would actually SEE (inside their
  // reach) — advertising "3 new jobs" that are all out of range sells a
  // subscription that unlocks nothing.
  const flReach = me.service_radius_mi + Math.max(15, Math.round(me.service_radius_mi * 0.4));
  const lockedFresh = hasFirstLook
    ? []
    : allEligible.filter(
        (x) =>
          inFirstLookWindow(x.p.created_at) &&
          x.p.id !== searchParams.offer &&
          (x.miles == null || x.miles <= flReach)
      );
  const lockedIds = new Set(lockedFresh.map((x) => x.p.id));
  const eligible = allEligible.filter((x) => !lockedIds.has(x.p.id));

  // Waterfall offer landing (?offer=<propertyId> from the offer email): pin
  // the offered job if it's still open; if it filled, say so honestly and
  // serve the next best open job in their range — first come, first served.
  const offeredLead = searchParams.offer ? market.find((l) => l.p.id === searchParams.offer) : null;
  // A CLOSED lead is absent from the market — check unlocks directly so a
  // buyer who bought the offered job (e.g. the exclusive) isn't told it
  // "went to other companies".
  const [myOfferUnlock] = searchParams.offer
    ? await db
        .select({ id: leadUnlock.id })
        .from(leadUnlock)
        .where(and(eq(leadUnlock.buyer_id, me.id), eq(leadUnlock.property_id, searchParams.offer)))
        .limit(1)
    : [undefined];
  const offerMine = (offeredLead?.holders.has(me.id) ?? false) || Boolean(myOfferUnlock);
  const offerItem = offeredLead && !offerMine ? toItem(offeredLead) : null;
  const offerGone = Boolean(searchParams.offer) && !offeredLead && !offerMine;
  const nextBest =
    offerGone
      ? (() => {
          const nb = nextBestFor(market, me, [searchParams.offer!]);
          return nb ? toItem(nb) : null;
        })()
      : null;

  // Radius decides ELIGIBILITY (in-range first, a cushion band below, clearly
  // flagged); the universal quality rank decides ORDER — contract value x
  // bid-window openness, no buyer-specific factors. Distance is displayed on
  // the card so the buyer weighs the drive themselves.
  const radius = me.service_radius_mi;
  const hasOffice = me.lat != null && me.lng != null;
  const cushion = Math.max(15, Math.round(radius * 0.4));
  const inRange = eligible
    .filter((x) => x.miles == null || x.miles <= radius)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 12);
  const nearby = eligible
    .filter((x) => x.miles != null && x.miles > radius && x.miles <= radius + cushion)
    .sort((a, b) => (a.miles ?? 0) - (b.miles ?? 0))
    .slice(0, 6);
  const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

  // ---- Alert feed: real activity, newest first. "Unread" = newer than the
  // buyer's alerts_seen_at marker (badge + green dot until they mark it read).
  type Alert = { at: Date; icon: string; text: string; href?: string };
  const alerts: Alert[] = [];
  const fortnightAgo = Date.now() - 14 * 86400_000;

  // New jobs that appeared in their range recently.
  for (const item of inRange) {
    if (item.p.created_at.getTime() < fortnightAgo) continue;
    alerts.push({
      at: item.p.created_at,
      icon: "🆕",
      text: `New job in your area${item.p.city ? ` — ${item.p.city}` : ""}${
        item.value ? `, est. ${usd(item.value.annualLo)}–${usd(item.value.annualHi)}/yr` : ""
      }`,
    });
  }
  // A prospect opened their quote page — the hottest signal they get.
  for (const p of myProspects) {
    if (!p.last_viewed_at) continue;
    alerts.push({
      at: p.last_viewed_at,
      icon: "👀",
      text: `Your quote for ${p.name || p.address} was opened${(p.views ?? 0) > 1 ? ` (${p.views}× total)` : ""}`,
      href: `/buyers/prospects/${p.id}`,
    });
  }
  // Postcards in the mail.
  for (const pc of myPostcards) {
    if (pc.status !== "created") continue;
    alerts.push({
      at: pc.created_at,
      icon: "📬",
      text: `Postcard to ${pc.to_name ?? "the owner"} is in the mail${pc.expected_delivery ? ` — arrives ~${pc.expected_delivery}` : ""}`,
      href: pc.unlock_id ? `/buyers/leads/${pc.unlock_id}` : pc.prospect_id ? `/buyers/prospects/${pc.prospect_id}` : undefined,
    });
  }
  // A reply from the Greenkeep team in chat.
  const lastOp = [...chatRows].reverse().find((m) => m.sender !== "buyer");
  if (lastOp) {
    alerts.push({ at: lastOp.created_at, icon: "💬", text: `New message from the ${brand} team — open the chat below` });
  }
  alerts.sort((a, b) => b.at.getTime() - a.at.getTime());
  const feed = alerts.slice(0, 8);
  const seenAt = me.alerts_seen_at?.getTime() ?? 0;
  const unseen = feed.filter((a) => a.at.getTime() > seenAt).length;
  const alertTime = (d: Date) =>
    d.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const initials = me.company_name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const complete = profileComplete(me);
  const purchased = mine.filter(({ unlock }) => unlock.kind !== "free").length;

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
          <Logo name={brand} />
          <div className="flex items-center gap-5 text-sm font-medium">
            <Link href="/buyers/prospects" className="text-gray-600 hover:text-gray-900">
              My prospects
            </Link>
            <Link href="/buyers/residential" className="text-gray-600 hover:text-gray-900">
              Residential
            </Link>
            <Link href="/buyers/profile" className="text-gray-600 hover:text-gray-900">
              Profile
            </Link>
            <form action={buyerLogout}>
              <button className="text-gray-600 hover:text-gray-900">Sign out</button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-6 py-8 lg:grid-cols-[300px_1fr]">
        {/* ---- Left rail: LinkedIn-style profile card ---- */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="h-16" style={{ background: `linear-gradient(120deg, ${accent}, ${accent}b0)` }} />
            <div className="px-5 pb-5">
              {me.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={me.logo_url}
                  alt={me.company_name}
                  className="-mt-8 h-16 w-16 rounded-full border-4 border-white bg-white object-contain shadow"
                />
              ) : (
                <div
                  className="-mt-8 flex h-16 w-16 items-center justify-center rounded-full border-4 border-white text-xl font-bold text-white shadow"
                  style={{ backgroundColor: accent }}
                >
                  {initials || "🌿"}
                </div>
              )}
              <div className="mt-3 text-lg font-bold leading-tight text-gray-900">{me.company_name}</div>
              {me.contact_name ? <div className="text-sm text-gray-600">{me.contact_name}</div> : null}
              <div className="mt-1 space-y-0.5 text-sm text-gray-500">
                <div className="truncate">{me.email}</div>
                {me.city ? <div>{me.city} · within {me.service_radius_mi} mi</div> : null}
                {me.phone ? <div>{me.phone}</div> : null}
              </div>

              {!complete ? (
                <Link
                  href="/buyers/profile"
                  className="mt-4 block rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-800 hover:bg-amber-100"
                >
                  Complete your profile → auto-fill your outreach letters
                </Link>
              ) : (
                <Link
                  href="/buyers/profile"
                  className="mt-4 block rounded-lg border border-gray-300 px-3 py-2 text-center text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Edit profile
                </Link>
              )}

              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-gray-100 pt-4 text-center">
                <div>
                  <div className="text-lg font-bold text-gray-900">{purchased}</div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">Unlocked</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-gray-900">{inRange.length}</div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">Open near you</div>
                </div>
              </div>
            </div>
          </div>

          {me.credit_cents > 0 ? (
            <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
              <div className="font-semibold">${Math.round(me.credit_cents / 100).toLocaleString()} account credit</div>
              <div className="mt-0.5 text-xs">Applies automatically on your next unlock.</div>
            </div>
          ) : null}

          {/* Self-serve prospecting */}
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900">My prospects</div>
              <Link href="/buyers/prospects" className="text-xs font-semibold text-brand hover:underline">
                Open →
              </Link>
            </div>
            {prospectCount > 0 ? (
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-lg font-bold text-gray-900">{prospectCount}</div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">Prospects</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-gray-900">{prospectMailed}</div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">Mailed</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-gray-900">{prospectViews}</div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">Quote opens</div>
                </div>
              </div>
            ) : (
              <>
                <p className="mt-1 text-xs text-gray-500">
                  Have targets of your own? Paste in the addresses you want to win — we measure
                  and price every one <span className="font-semibold text-gray-700">free</span>,
                  and you can mail a branded postcard that drives to your own quote page.
                </p>
                <Link
                  href="/buyers/prospects"
                  className="mt-3 block w-full rounded-lg bg-brand px-3 py-2 text-center text-xs font-bold text-white hover:bg-brand-dark"
                >
                  Scan my targets — free
                </Link>
              </>
            )}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">Email alerts</div>
                <div className="mt-0.5 text-xs text-gray-500">
                  {me.notify ? "On — emailed when a job opens near you." : "Off."}
                </div>
              </div>
              <form action={toggleNotifications.bind(null, !me.notify)}>
                <button
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${me.notify ? "bg-brand/10 text-brand" : "border border-gray-300 text-gray-600"}`}
                >
                  {me.notify ? "On" : "Off"}
                </button>
              </form>
            </div>
          </div>
        </aside>

        {/* ---- Main column ---- */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your job leads</h1>
          <p className="mt-1 text-sm text-gray-500">High-intent commercial grounds contracts near you.</p>

          {searchParams.unlocked ? (
            <p className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              Done — your lead appears under &quot;Your leads&quot; the moment the unlock confirms
              (usually seconds; refresh if needed). If the last spot went to another company while
              you were paying, the charge becomes account credit automatically and we email you —
              it never disappears.
            </p>
          ) : null}
          {searchParams.firstlook ? (
            <p className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              First Look is activating — brand-new jobs unlock for you the moment the subscription
              confirms (usually under a minute; refresh to see them).
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

        {/* ---- Offer landing: pinned if open, honest + next-best if filled -- */}
        {offerItem ? (
          <section className="mt-6">
            <div className="rounded-t-2xl border border-b-0 px-5 py-3 text-sm font-semibold text-white" style={{ backgroundColor: accent, borderColor: accent }}>
              🎯 Offered to you — {offerItem.spotsLeft === 1 ? "the LAST spot is open" : `${offerItem.spotsLeft} of ${cap} spots still open`}. First come, first served.
            </div>
            <LeadCard item={offerItem} freeAvailable={freeAvailable} cap={cap} usd={usd} pinned />
          </section>
        ) : null}
        {offerMine ? (
          <p className="mt-6 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            The job from that offer is already yours — it&apos;s in your unlocked list below.
          </p>
        ) : null}
        {offerGone ? (
          <section className="mt-6">
            <div className={`border px-5 py-3 text-sm font-medium text-amber-900 ${nextBest ? "rounded-t-2xl border-b-0 border-amber-300 bg-amber-50" : "rounded-2xl border-amber-300 bg-amber-50"}`}>
              That job filled up — all {cap} spots went to other companies. First come, first served.
              {nextBest ? " Here's the next best open job near you:" : " We'll email you the moment the next one lands in your area."}
            </div>
            {nextBest ? (
              <LeadCard item={nextBest} freeAvailable={freeAvailable} cap={cap} usd={usd} pinned />
            ) : null}
          </section>
        ) : null}

        {/* ---- Alerts: what happened since you last looked ---------------- */}
        {feed.length > 0 ? (
          <section className="mt-6 rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-gray-900">Alerts</h2>
                {unseen > 0 ? (
                  <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-white">
                    {unseen} new
                  </span>
                ) : null}
              </div>
              {unseen > 0 ? (
                <form action={markAlertsSeen}>
                  <button className="text-xs font-semibold text-gray-500 hover:text-gray-800">
                    Mark all read
                  </button>
                </form>
              ) : null}
            </div>
            <ul className="divide-y divide-gray-50 px-5 py-1">
              {feed.map((a, i) => {
                const isNew = a.at.getTime() > seenAt;
                const body = (
                  <div className="flex items-start gap-3 py-2.5">
                    <span className="text-base leading-6">{a.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm ${isNew ? "font-semibold text-gray-900" : "text-gray-600"}`}>
                        {a.text}
                        {a.href ? <span className="ml-1 text-brand">→</span> : null}
                      </div>
                      <div className="mt-0.5 text-[11px] text-gray-400">{alertTime(a.at)}</div>
                    </div>
                    {isNew ? <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand" /> : null}
                  </div>
                );
                return (
                  <li key={i}>
                    {a.href ? (
                      <Link href={a.href} className="block hover:bg-gray-50">
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {/* ---- Unlocked leads -------------------------------------------- */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Unlocked — yours
          </h2>
          {mine.length === 0 ? (
            <div className="mt-3 rounded-2xl border-2 border-dashed border-gray-300 bg-white p-6 text-center shadow-sm">
              <p className="text-sm font-medium text-gray-700">
                Nothing unlocked yet{freeAvailable ? " — your first sheet is free." : "."}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {freeAvailable
                  ? "Pick any job below and hit the green button. The full sheet — address, contacts, measurement, bid window — appears here."
                  : "Claim a job below and the full sheet — address, contacts, measurement, bid window — appears here."}
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {mine.map(({ unlock, prop }) => {
                const d = unlock.dossier as { annual_lo?: number; annual_hi?: number } | null;
                return (
                  <Link
                    key={unlock.id}
                    href={`/buyers/leads/${unlock.id}`}
                    className="block rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-brand hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-medium text-gray-900">
                          {displayName(prop.name)}
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
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-sm font-medium text-brand">View full sheet →</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[unlock.outreach_status] ?? "bg-gray-100 text-gray-500"}`}
                      >
                        {STATUS_LABEL[unlock.outreach_status] ?? "New"}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* ---- Open opportunities (within radius) ------------------------ */}
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            {hasOffice ? "Open in your area" : "Open jobs"}
            <span className="ml-2 font-normal normal-case tracking-normal text-gray-400">
              {hasOffice ? `within ${radius} mi of ${me.city ?? "your office"}` : "statewide"}
            </span>
          </h2>
          {!hasOffice ? (
            <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Showing every open job because your office location isn&apos;t set —{" "}
              <Link href="/buyers/profile" className="font-semibold underline">
                add your city or address
              </Link>{" "}
              to filter to your service area.
            </p>
          ) : null}
          <p className="mt-1 text-xs text-gray-400">
            Every job is capped at {cap} companies* — ever. Or lock one down as an exclusive and
            nobody else gets it. If a job sells out before your payment settles, your payment
            instantly becomes account credit that auto-applies to any job at or below that amount — it never disappears.
            {" "}<Link href="/terms" className="underline">*Terms</Link>
          </p>
          {/* First Look: what the machine manufactures is EARLINESS — sold
              directly. Members see the window's jobs; others see the count. */}
          {!hasFirstLook && lockedFresh.length > 0 ? (
            <div className="mt-3 rounded-2xl border-2 border-dashed border-brand/40 bg-brand/5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-gray-900">
                    🔒 {lockedFresh.length} brand-new job{lockedFresh.length === 1 ? "" : "s"} in
                    the First Look window
                  </div>
                  <p className="mt-1 text-xs text-gray-600">
                    First Look members see every job the moment it lands — a{" "}
                    {FIRST_LOOK_HOURS}-hour head start on a market where jobs cap at {cap}{" "}
                    companies. The freshest one here goes public in ~
                    {hoursUntilPublic(
                      lockedFresh.reduce(
                        (m, x) => (x.p.created_at > m ? x.p.created_at : m),
                        lockedFresh[0].p.created_at
                      )
                    )}
                    h.
                  </p>
                </div>
                <form action={startFirstLookCheckout}>
                  <button className="rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-dark">
                    Get First Look — ${Math.round(firstLookPriceCents() / 100)}/mo
                  </button>
                </form>
              </div>
            </div>
          ) : null}
          {hasFirstLook ? (
            <p className="mt-2 text-xs font-semibold text-brand">
              ⚡ First Look active — you see new jobs {FIRST_LOOK_HOURS}h before everyone else
              {me.plan_expires_at
                ? ` (renews by ${me.plan_expires_at.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" })})`
                : ""}
              .
            </p>
          ) : null}
          {inRange.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
              Nothing open inside your {radius}-mile range right now.
              {nearby.length ? " A few just outside are below." : ""} We&apos;ll email you when a
              new job lands{me.city ? ` near ${me.city}` : " in your area"}.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {inRange.map((item) => (
                <LeadCard
                  key={item.p.id}
                  item={item}
                  freeAvailable={freeAvailable}
                  cap={cap}
                  usd={usd}
                />
              ))}
            </div>
          )}
        </section>

        {/* ---- Just outside your range ----------------------------------- */}
        {nearby.length ? (
          <section className="mt-10">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Just outside your range
            </h2>
            <p className="mt-1 text-xs text-gray-400">
              A bit past your {radius}-mile radius — worth a look if the contract value justifies the
              drive. Widen your range in{" "}
              <Link href="/buyers/profile" className="underline hover:text-gray-600">
                your profile
              </Link>{" "}
              to see more.
            </p>
            <div className="mt-3 space-y-3">
              {nearby.map((item) => (
                <LeadCard
                  key={item.p.id}
                  item={item}
                  freeAvailable={freeAvailable}
                  cap={cap}
                  usd={usd}
                  outside
                />
              ))}
            </div>
          </section>
        ) : null}

        </div>
      </main>

      <ChatWidget mode="buyer" messages={chat} sendAction={sendChatMessage} />
    </div>
  );
}

type LeadItem = {
  p: typeof property.$inferSelect;
  teaser: { annual_lo?: number; annual_hi?: number; turf_sqft?: number } | null;
  /** THIS buyer's trade + its own value estimate — the shelf never shows a
   *  pest company a landscaping dollar figure. */
  trade: Trade;
  value: TradeValueEstimate | null;
  kind: LeadKind;
  cost: string | null;
  workType: string | null;
  timing: string;
  spotsLeft: number;
  exclusiveOpen: boolean;
  free: FreeClaimVerdict;
  priceTier: LeadTier;
  rank: number;
  miles: number | null;
};

function LeadCard({
  item,
  freeAvailable,
  cap,
  usd,
  outside,
  pinned,
}: {
  item: LeadItem;
  freeAvailable: boolean;
  cap: number;
  usd: (n: number) => string;
  outside?: boolean;
  pinned?: boolean;
}) {
  const { p, teaser, trade, value, kind, cost, workType, timing, spotsLeft, exclusiveOpen, free, miles, priceTier } = item;
  const price = Math.round(priceTier.price_cents / 100);
  const exclusivePrice = Math.round(priceTier.exclusive_cents / 100);
  // Trade-voiced copy: a pest/cleaning/paving buyer never reads "grounds".
  const svc = TRADES[trade].service;
  const svcCap = svc.charAt(0).toUpperCase() + svc.slice(1);
  const contractWord = trade === "landscaping" ? "Grounds contract" : `${svcCap} contract`;
  return (
    <div
      className={`overflow-hidden border bg-white shadow-sm transition hover:shadow-md ${
        pinned ? "rounded-b-2xl" : "rounded-2xl"
      } ${outside ? "border-gray-200 opacity-90" : "border-gray-200"}`}
    >
      <div className="flex flex-wrap items-stretch justify-between gap-x-6 gap-y-4 p-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {value ? (
              <span className="text-2xl font-extrabold tracking-tight text-gray-900">
                {usd(value.annualLo)}–{usd(value.annualHi)}
                <span className="text-sm font-semibold text-gray-400">/yr</span>
              </span>
            ) : (
              <span className="text-2xl font-extrabold tracking-tight text-gray-900">
                {cost ?? "Large"} project
              </span>
            )}
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                spotsLeft === 1 ? "bg-amber-100 text-amber-800" : "bg-brand/10 text-brand"
              }`}
            >
              {spotsLeft === 1 ? "LAST SPOT" : `${spotsLeft} of ${cap} spots left`}
            </span>
            {priceTier.label ? (
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  priceTier.tier === "premium" ? "bg-amber-400/20 text-amber-700" : "bg-green-100 text-green-800"
                }`}
              >
                {priceTier.label}
              </span>
            ) : null}
            {(teaser as { verified?: boolean } | null)?.verified ? (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                VERIFIED MEASUREMENT
              </span>
            ) : null}
            {outside && miles != null ? (
              <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-bold text-gray-500">
                {miles} MI — OUTSIDE RANGE
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-sm font-medium text-gray-700">
            {kind === "transfer"
              ? `${contractWord} at a property under new ownership — vendors get re-bid`
              : kind === "opening"
                ? `${contractWord} where a new business is opening — decisions in motion`
                : kind === "violation"
                  ? "Property cited by the city for grounds/cleanup conditions — the owner must hire someone now"
                  : kind === "distress"
                    ? "Property in the county tax-sale pipeline — cleanup needed now, every vendor re-bid after the sale"
                    : kind === "rfp"
                      ? "Public grounds/landscaping contract out for bid — multi-year government money"
                      : `${contractWord} behind a ${cost ?? "major"} ${(workType ?? "commercial").toLowerCase()} project`}
            {p.city ? ` — ${p.city} area` : ""}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-gray-500">
            {miles != null ? (
              <span className={outside ? "font-semibold text-gray-500" : "font-semibold text-brand"}>
                ~{miles} mi from your office
              </span>
            ) : null}
            <span>{timing}</span>
            {trade === "landscaping" && teaser?.turf_sqft ? (
              <span>{teaser.turf_sqft.toLocaleString()} sf of grounds</span>
            ) : null}
            {trade !== "landscaping" && value ? <span>{value.basis}</span> : null}
          </div>
          <div className="mt-2 text-xs text-gray-400">
            {kind === "rfp"
              ? "Brief includes the solicitation link, agency, deadline, and a vendor-registration letter."
              : "Sheet includes the exact address, aerial measurement, decision contacts, bid window, and intro letter."}
          </div>
        </div>
        <div className="flex w-full flex-col justify-center gap-2 sm:w-56">
          {freeAvailable && free.allowed ? (
            <form action={claimFreeLead.bind(null, p.id)}>
              <button className="w-full rounded-lg bg-brand px-4 py-3 text-[15px] font-bold text-white shadow-sm transition hover:bg-brand-dark">
                Claim free — first sheet on us
              </button>
            </form>
          ) : (
            <form action={startCheckout.bind(null, p.id, "paid")}>
              <button className="w-full rounded-lg bg-brand px-4 py-3 text-[15px] font-bold text-white shadow-sm transition hover:bg-brand-dark">
                Unlock the sheet — ${price}
              </button>
            </form>
          )}
          {exclusiveOpen ? (
            <form action={startCheckout.bind(null, p.id, "exclusive")}>
              <button className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50">
                Lock it down — ${exclusivePrice} exclusive
              </button>
            </form>
          ) : null}
          {value && !freeAvailable ? (
            <p className="text-center text-[11px] text-gray-400">
              ${price} for a {usd(value.annualLo)}+/yr contract lead
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
