import Link from "next/link";
import { requestBuyerLink } from "../actions";
import { getDefaultCompany } from "@/lib/db/queries";
import { Logo } from "@/components/Logo";

// Public: buyers request a passwordless magic link. Anti-enumeration — always
// the same "check your inbox" regardless of whether the email exists.
export const dynamic = "force-dynamic";

export default async function BuyerLogin({
  searchParams,
}: {
  searchParams: { sent?: string; error?: string; expired?: string };
}) {
  const co = await getDefaultCompany();
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8">
        <Logo name={co?.name ?? "Greenkeep"} />
        <h1 className="mt-4 text-xl font-semibold">Job-leads sign-in</h1>
        <p className="mt-1 text-sm text-gray-500">
          Enter your email and we&apos;ll send a secure sign-in link — no password needed.
        </p>

        {searchParams.expired ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            That link has expired — request a fresh one below.
          </p>
        ) : null}

        {searchParams.sent ? (
          <p className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            Check your inbox — if your email is on file, a sign-in link is on its way (expires in
            30 minutes).
          </p>
        ) : (
          <form action={requestBuyerLink} className="mt-6 space-y-3">
            <input
              type="email"
              name="email"
              required
              autoFocus
              placeholder="you@yourcompany.com"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
            {searchParams.error ? (
              <p className="text-sm text-red-600">Please enter a valid email.</p>
            ) : null}
            <button
              type="submit"
              className="w-full rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark"
            >
              Email me a sign-in link
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-gray-400">
          <Link href="/" className="hover:text-gray-600">← Back to home</Link>
        </p>
      </div>
    </div>
  );
}
