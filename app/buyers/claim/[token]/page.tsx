import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, leadUnlock, property } from "@/lib/db/schema";
import { verifyBuyerClaim } from "@/lib/buyer-auth";
import { getDefaultCompany } from "@/lib/db/queries";
import { FREE_MAX_PER_LEAD } from "@/lib/leads/allocation";
import { leadAvailability, leadMaxBuyers } from "@/lib/leads/availability";
import { leadKind } from "@/lib/leads/market";
import { claimAsExistingBuyer, createBuyerProfile, currentBuyerId } from "../../actions";
import { asTrade, TRADES, tradeValueInput } from "@/lib/leads/trades";
import { recordClaimView } from "@/lib/leads/companies";
import { Logo } from "@/components/Logo";
import { openInventoryFor } from "@/lib/sms/ai-context";

// Public claim landing (token-authenticated): the campaign teaser links here.
// Shows what we can say for free (project value, type, timing, area — never the
// address) and a 3-field profile form. Creating the profile IS the opt-in and
// unlocks the free lead if a shared spot is still open.
export const dynamic = "force-dynamic";
// createBuyerProfile builds the dossier snapshot (TABS + Mapbox + county) —
// give the action room beyond the platform default.
export const maxDuration = 60;

const note = (notes: string | null, re: RegExp) => notes?.match(re)?.[1]?.trim() ?? null;

export default async function ClaimPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { error?: string; trade?: string };
}) {
  const claim = verifyBuyerClaim(params.token);
  const co = await getDefaultCompany();
  const brand = co?.name ?? "Greenkeep";

  if (!claim) {
    return (
      <Shell brand={brand}>
        <h1 className="mt-4 text-xl font-semibold">This link has expired</h1>
        <p className="mt-2 text-sm text-gray-500">
          No problem — if you already have a profile, sign in below. Otherwise reply to the
          message we sent you and we&apos;ll issue a fresh link.
        </p>
        <Link
          href="/buyers/login"
          className="mt-6 block w-full rounded-md bg-brand px-3 py-2 text-center text-sm font-medium text-white hover:bg-brand-dark"
        >
          Sign in
        </Link>
      </Shell>
    );
  }

  const [prop] = await db.select().from(property).where(eq(property.id, claim.property_id)).limit(1);
  // A browser that already holds a buyer session skips the form entirely —
  // they told us who they are when they signed up; asking again is friction.
  const sessionBuyerId = await currentBuyerId();
  const [me] = sessionBuyerId
    ? await db
        .select({ company_name: buyer.company_name, email: buyer.email })
        .from(buyer)
        .where(eq(buyer.id, sessionBuyerId))
        .limit(1)
    : [];
  // The hot unconverted signal: this company opened the offer. Best-effort —
  // never blocks the render. (Link-preview bots inflate this slightly; it's
  // a call-list ranking signal, not billing.)
  await recordClaimView(claim.company);
  // Pre-signup, the trade comes from the outreach link (?trade=).
  const trade = asTrade(searchParams.trade);
  // Sellable = measured OR public-bid (RFPs carry no parcel) — the same rule
  // as the unlock actions. Gating on parcel alone made an RFP claim link
  // falsely claim "all spots went to other companies".
  const sellable = !!prop && (prop.parcel_geojson != null || leadKind(prop.name) === "rfp");
  const avail = prop && sellable ? await leadAvailability(prop, trade) : null;
  // "Claimable FREE" needs both an open spot AND the per-lead free budget —
  // promising "reserved for you" and then quoting a price is the one flow
  // that must never happen.
  const freeSpent = prop
    ? (
        await db
          .select({ trade: leadUnlock.trade })
          .from(leadUnlock)
          .where(and(eq(leadUnlock.property_id, prop.id), eq(leadUnlock.kind, "free")))
      ).filter((u) => u.trade === trade).length >= FREE_MAX_PER_LEAD
    : false;
  const claimable = !!avail?.open && !freeSpent;
  // Free spot spent but paid spots remain: say exactly that. Collapsing this
  // into "filled up" told engaged companies a lead was gone while 2/3 spots
  // sat open — false scarcity, and it turns away ready buyers.
  const paidOpen = !!avail?.open && freeSpent;
  const cap = leadMaxBuyers();

  const cost = note(prop?.notes ?? null, /est\. cost (\$[\d,]+)/);
  const workType = note(prop?.notes ?? null, /: ([^,]+), est\. cost/);
  const start = note(prop?.notes ?? null, /Est\. start ([\d-]+)/);
  // The lead block mirrors the outreach memo, so the click delivers exactly
  // what the email promised (still teaser-safe — no address, no owner).
  const kind = prop ? leadKind(prop.name) : null;
  const teaser = (prop?.lead_teaser ?? null) as
    | { annual_lo?: number; annual_hi?: number; turf_sqft?: number; verified?: boolean }
    | null;
  const trigger =
    kind === "transfer"
      ? `Changed owners${note(prop!.notes, /HCAD transfer ([\d-]+)/) ? ` on ${note(prop!.notes, /HCAD transfer ([\d-]+)/)}` : " recently"} — new owners re-bid their vendors in the first year`
      : kind === "opening"
        ? `New business opening${note(prop!.notes, /Opens ([\d-]+)/) ? ` around ${note(prop!.notes, /Opens ([\d-]+)/)}` : " soon"} — vendor decisions in motion`
        : kind === "violation"
          ? `Cited by the city${note(prop!.notes, /311 case \S+ \(([\d-]+)\)/) ? ` on ${note(prop!.notes, /311 case \S+ \(([\d-]+)\)/)}` : ""} — the owner must arrange service now`
          : kind === "distress"
            ? `In the county tax-sale process${note(prop!.notes, /Tax sale scheduled ([\d-]+)/) ? ` — auction ${note(prop!.notes, /Tax sale scheduled ([\d-]+)/)}` : ""}`
            : cost
              ? `${cost} ${(workType ?? "commercial").toLowerCase()} project${start ? `, breaking ground around ${start}` : ""}`
              : "Large commercial project";
  const usdShort = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const sqftShort = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M sq ft` : `${Math.round(n / 1000)}k sq ft`;
  // The value lines mirror the trade's OWN memo: landscaping quotes the
  // aerial teaser; every other trade quotes its county-records estimate and
  // never a turf number (meaningless to a cleaning or HVAC company).
  const est = prop && kind ? TRADES[trade].estimateValue(tradeValueInput(prop, kind)) : null;

  // The carousel: other open jobs in the same metro, each with its own
  // preview link minted for this company. Best-effort — never blocks render.
  const similar = prop
    ? await openInventoryFor({
        companyName: claim.company ?? "",
        trade,
        lat: prop.lat,
        lng: prop.lng,
        excludePropertyId: prop.id,
        limit: 4,
      })
    : [];

  return (
    <Shell brand={brand}>
      <h1 className="mt-3 text-xl font-semibold">Claim your free job sheet</h1>

      {claimable || paidOpen ? (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm sm:p-4">
          <div className="font-medium text-gray-900">
            {claimable ? "Reserved for you:" : "Still open — the free spot went fast:"}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5 text-center sm:gap-2">
            {est ? (
              <div className="rounded-md bg-white px-1 py-2">
                <div className="text-sm font-bold text-gray-900">{usdShort(est.annualLo)}–{usdShort(est.annualHi)}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400">{est.per === "project" ? "project value" : "per year"}</div>
              </div>
            ) : null}
            {trade === "landscaping" && teaser?.turf_sqft ? (
              <div className="rounded-md bg-white px-1 py-2">
                <div className="text-sm font-bold text-gray-900">{sqftShort(teaser.turf_sqft)}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400">grounds</div>
              </div>
            ) : null}
            <div className="rounded-md bg-white px-1 py-2">
              <div className="text-sm font-bold text-amber-700">{avail!.spotsLeft} of {cap}</div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400">spots left</div>
            </div>
          </div>
          {/* The tiles already carry the numbers — the bullets add only what
              the tiles can't say, so the CTA stays near the fold on phones. */}
          <ul className="mt-2 space-y-1 text-gray-600">
            <li>• {trigger}</li>
            {trade === "landscaping" && teaser?.turf_sqft && teaser.verified ? (
              <li>• Grounds hand-verified from aerial measurement</li>
            ) : null}
            {trade !== "landscaping" && est ? <li>• {est.basis}</li> : null}
            {prop!.city ? <li>• {prop!.city} area</li> : null}
            <li>• Full sheet: exact location, decision contacts, contract value, and the window to bid</li>
          </ul>
          <p className="mt-2 text-xs text-gray-400">
            {claimable ? (
              <>
                Every job is capped at {cap} companies* — ever.
                {avail!.spotsLeft === 1 ? " This is the last spot." : ""}
              </>
            ) : (
              <>
                Another company claimed the free spot, but {avail!.spotsLeft} of {cap} spots on
                this job {avail!.spotsLeft === 1 ? "is" : "are"} still open* — create your profile
                to see it, and your free sheet applies to the next open job near you.
              </>
            )}{" "}
            <Link href="/terms" className="underline">*Terms</Link>
          </p>
        </div>
      ) : (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {prop ? (
            <>
              <span className="font-semibold">This one filled up</span> — all {cap} spots went to
              other companies. First come, first served is real here.{" "}
              <span className="font-semibold">Your free sheet is still yours:</span> create your
              profile below and we&apos;ll line up the next best open job in the same area — most
              can be claimed free, and you&apos;ll get first look when new jobs land near you.
            </>
          ) : (
            "Create your profile and you'll see the jobs open in your area."
          )}
        </p>
      )}

      {me ? (
        <form action={claimAsExistingBuyer.bind(null, params.token)} className="mt-5 space-y-3">
          <button
            type="submit"
            className="w-full rounded-md bg-brand px-3 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            {claimable ? "Unlock my free sheet" : paidOpen ? "See this job" : "See open jobs near me"}
          </button>
          <p className="text-center text-[11px] leading-4 text-gray-400">
            Signed in as {me.company_name} ({me.email}) ·{" "}
            <Link href="/buyers/login" className="underline">not you?</Link>
          </p>
        </form>
      ) : (
        <form action={createBuyerProfile.bind(null, params.token)} className="mt-5 space-y-3">
          {/* Trade from the outreach link — scopes the shelf/copy after signup. */}
          <input type="hidden" name="trade" value={asTrade(searchParams.trade)} />
          <input
            type="text"
            name="company"
            required
            defaultValue={claim.company ?? ""}
            placeholder="Company name"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
          <input
            type="email"
            name="email"
            required
            autoFocus={!!claim.company}
            placeholder="you@yourcompany.com"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
          <input
            type="text"
            name="city"
            placeholder="Office city (so we match jobs near you)"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
          {searchParams.error ? (
            <p className="text-sm text-red-600">Please enter your company name and a valid email.</p>
          ) : null}
          <button
            type="submit"
            className="w-full rounded-md bg-brand px-3 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            {claimable
              ? "Create profile & unlock my free sheet"
              : paidOpen
                ? "Create profile & see this job"
                : "Create profile"}
          </button>
          <p className="text-center text-[11px] leading-4 text-gray-400">
            No card required. Unsubscribe any time. By creating a profile you agree to our{" "}
            <Link href="/terms" className="underline">Terms</Link> and{" "}
            <Link href="/privacy" className="underline">Privacy Policy</Link>.
          </p>
        </form>
      )}

      {similar.length > 0 ? (
        <div className="mt-8 border-t border-gray-100 pt-5">
          <h2 className="text-sm font-semibold text-gray-700">
            More open jobs near you
          </h2>
          <div className="-mx-2 mt-3 flex snap-x gap-3 overflow-x-auto px-2 pb-2">
            {similar.map((s) => (
              <a
                key={s.propertyId}
                href={s.claimUrl}
                className="w-44 shrink-0 snap-start rounded-lg border border-gray-200 bg-gray-50 p-3 hover:border-brand"
              >
                <div className="text-xs font-semibold text-gray-900">
                  {s.city ?? "Nearby"}
                </div>
                {s.valueLo != null && s.valueHi != null ? (
                  <div className="mt-1 text-sm font-bold text-brand">
                    ${Math.round(s.valueLo / 1000)}k–${Math.round(s.valueHi / 1000)}k/yr
                  </div>
                ) : null}
                {s.reasons.length ? (
                  <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-gray-500">
                    {s.reasons.join(" · ")}
                  </div>
                ) : null}
                <div className="mt-2 text-[11px] font-semibold text-brand">Preview →</div>
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </Shell>
  );
}

function Shell({ brand, children }: { brand: string; children: React.ReactNode }) {
  // Phones get nearly the full width (the page px + card p stack up fast on a
  // 390px screen); the roomier padding is desktop-only.
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-2.5 py-4 sm:px-6 sm:py-10">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-4 sm:p-8">
        <Logo name={brand} />
        {children}
      </div>
    </div>
  );
}
