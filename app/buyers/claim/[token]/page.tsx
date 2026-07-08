import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { property } from "@/lib/db/schema";
import { verifyBuyerClaim } from "@/lib/buyer-auth";
import { getDefaultCompany } from "@/lib/db/queries";
import { leadAvailability, leadMaxBuyers } from "@/lib/leads/availability";
import { createBuyerProfile } from "../../actions";
import { asTrade } from "@/lib/leads/trades";
import { Logo } from "@/components/Logo";

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
  // Pre-signup, the trade comes from the outreach link (?trade=).
  const avail = prop && prop.parcel_geojson ? await leadAvailability(prop, asTrade(searchParams.trade)) : null;
  const claimable = !!avail?.open;
  const cap = leadMaxBuyers();

  const cost = note(prop?.notes ?? null, /est\. cost (\$[\d,]+)/);
  const workType = note(prop?.notes ?? null, /: ([^,]+), est\. cost/);
  const start = note(prop?.notes ?? null, /Est\. start ([\d-]+)/);

  return (
    <Shell brand={brand}>
      <h1 className="mt-4 text-xl font-semibold">Claim your free job sheet</h1>

      {claimable ? (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
          <div className="font-medium text-gray-900">Reserved for you:</div>
          <ul className="mt-2 space-y-1 text-gray-600">
            {cost ? <li>• {cost} {workType ?? "commercial"} project</li> : <li>• Large commercial project</li>}
            {start ? <li>• Breaking ground around {start}</li> : null}
            {prop!.city ? <li>• {prop!.city} area</li> : null}
            <li>• Full sheet: exact location, decision contacts, our aerial measurement, contract value, and the window to bid</li>
          </ul>
          <p className="mt-2 text-xs text-gray-400">
            Every job is capped at {cap} companies* — ever.
            {avail!.spotsLeft === 1 ? " This is the last spot." : ""}{" "}
            <Link href="/terms" className="underline">*Terms</Link>
          </p>
        </div>
      ) : (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {prop
            ? `This job hit its ${cap}-company cap — we never oversell a lead. Create your profile anyway and you'll see what's open in your area, plus get first look at the next one.`
            : "Create your profile and you'll see the jobs open in your area."}
        </p>
      )}

      <form action={createBuyerProfile.bind(null, params.token)} className="mt-6 space-y-3">
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
          className="w-full rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark"
        >
          {claimable ? "Create profile & unlock my free sheet" : "Create profile"}
        </button>
        <p className="text-xs text-gray-400">
          No card required. We&apos;ll email you when new jobs open near your office — unsubscribe
          any time from your dashboard.
        </p>
      </form>
    </Shell>
  );
}

function Shell({ brand, children }: { brand: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6 py-10">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8">
        <Logo name={brand} />
        {children}
      </div>
    </div>
  );
}
