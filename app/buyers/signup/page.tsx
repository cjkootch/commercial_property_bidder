import Link from "next/link";
import { createBuyerAccount } from "../actions";
import { asTrade } from "@/lib/leads/trades";
import { getDefaultCompany } from "@/lib/db/queries";
import { Logo } from "@/components/Logo";

// Public signup for the lead marketplace (homepage CTA lands here). Organic
// buyers pick their free first sheet from the dashboard after signing up.
export const dynamic = "force-dynamic";

export default async function BuyerSignup({
  searchParams,
}: {
  searchParams: { error?: string; trade?: string };
}) {
  const co = await getDefaultCompany();
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6 py-10">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8">
        <Link href="/" aria-label={co?.name ?? "Greenkeep"}>
          <Logo name={co?.name ?? "Greenkeep"} />
        </Link>
        <h1 className="mt-4 text-xl font-semibold">Create your free profile</h1>
        <p className="mt-1 text-sm text-gray-500">
          See the commercial grounds jobs open near your office. Your first job sheet is free —
          no card required.
        </p>

        <form action={createBuyerAccount} className="mt-6 space-y-3">
          {/* Trade from the outreach link — scopes the shelf/copy after signup. */}
          <input type="hidden" name="trade" value={asTrade(searchParams.trade)} />
          <input
            type="text"
            name="company"
            required
            autoFocus
            placeholder="Company name"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
          <input
            type="email"
            name="email"
            required
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
            See jobs near me
          </button>
          <p className="text-xs text-gray-400">
            We&apos;ll email you when new jobs open near your office — one-click unsubscribe,
            any time.
          </p>
        </form>

        <p className="mt-6 text-center text-xs text-gray-400">
          Already have a profile?{" "}
          <Link href="/buyers/login" className="font-medium text-gray-600 hover:text-gray-900">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
