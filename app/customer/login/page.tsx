import Link from "next/link";
import { requestMagicLink } from "../actions";
import { Logo } from "@/components/Logo";

// Public: customers request a passwordless magic link. We never reveal whether
// an email exists (anti-enumeration) — always show the same "check your inbox".
export const dynamic = "force-dynamic";

export default function CustomerLogin({
  searchParams,
}: {
  searchParams: { sent?: string; error?: string };
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8">
        <Link href="/" aria-label="Greenkeep">
          <Logo name="Greenkeep" />
        </Link>
        <h1 className="mt-4 text-xl font-semibold">Customer sign-in</h1>
        <p className="mt-1 text-sm text-gray-500">
          Enter your email and we&apos;ll send you a secure sign-in link — no password needed.
        </p>

        {searchParams.sent ? (
          <p className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            Check your inbox — if your email is on file, a sign-in link is on its way (expires in
            30 minutes).
          </p>
        ) : (
          <form action={requestMagicLink} className="mt-6 space-y-3">
            <input
              type="email"
              name="email"
              required
              autoFocus
              placeholder="you@company.com"
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
