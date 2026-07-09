import Link from "next/link";
import { getDefaultCompany } from "@/lib/db/queries";
import { TRADES } from "@/lib/leads/trades";
import { Logo } from "@/components/Logo";
import { submitBidRequest } from "./actions";

// Owner-side landing: "get competing bids" — the reverse of the buyer
// marketplace. Public (middleware-whitelisted), no account needed.
export const dynamic = "force-dynamic";

export default async function BidsPage({
  searchParams,
}: {
  searchParams: { sent?: string; error?: string };
}) {
  const co = await getDefaultCompany();
  const brand = co?.name ?? "Greenkeep";
  const accent = co?.brand_color || "#2f7d4f";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-8">
        <Link href="/" aria-label={brand}>
          <Logo name={brand} accent={accent} />
        </Link>

        {searchParams.sent ? (
          <>
            <h1 className="mt-6 text-2xl font-bold">Request received ✓</h1>
            <p className="mt-3 text-sm leading-relaxed text-gray-600">
              We&apos;ll match your property with qualified local companies and you&apos;ll hear
              from up to three of them — usually within a couple of business days. No obligation,
              no fee to you.
            </p>
            <Link href="/" className="mt-6 inline-block text-sm font-semibold underline" style={{ color: accent }}>
              ← Back to {brand}
            </Link>
          </>
        ) : (
          <>
            <h1 className="mt-6 text-2xl font-bold">Get competing bids for your property</h1>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Tell us what you need and we&apos;ll put your property in front of up to three
              qualified local companies in that trade. They bid — you pick. Free for property
              owners and managers.
            </p>

            <form action={submitBidRequest} className="mt-6 space-y-3">
              <input type="text" name="name" required placeholder="Your name" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none" />
              <input type="email" name="email" required placeholder="you@company.com" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none" />
              <input type="text" name="phone" placeholder="Phone (optional)" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none" />
              <input type="text" name="address" required placeholder="Property address" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none" />
              <input type="text" name="city" placeholder="City" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none" />
              <select name="trade" className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none">
                {Object.values(TRADES).map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
              <textarea name="notes" rows={3} placeholder="What do you need? (scope, timing, anything useful)" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none" />
              {searchParams.error ? (
                <p className="text-sm text-red-600">
                  {searchParams.error === "rate"
                    ? "Too many requests — try again in a bit."
                    : "Please fill in your name, a valid email, and the property address."}
                </p>
              ) : null}
              <button type="submit" className="w-full rounded-lg px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-90" style={{ backgroundColor: accent }}>
                Request bids — free
              </button>
              <p className="text-center text-[11px] text-gray-400">
                By submitting you agree to our{" "}
                <Link href="/terms" className="underline">Terms</Link> and{" "}
                <Link href="/privacy" className="underline">Privacy Policy</Link>. We&apos;ll share
                your request only with the companies bidding.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
