import Link from "next/link";
import { resolveTenant } from "@/lib/tenant";
import { Logo } from "@/components/Logo";
import { SiteFooter } from "@/components/SiteFooter";

// Contact: one real channel, clearly stated. No fake office grid, no fake
// phone tree — a diligence-minded visitor should find exactly what exists.
export const dynamic = "force-dynamic";

export default async function ContactPage() {
  const co = await resolveTenant();
  const brand = co?.name ?? "Greenkeep";
  const accent = co?.brand_color || "#2f7d4f";

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <header className="border-b border-gray-100">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/">
            <Logo name={brand} accent={accent} />
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link href="/buyers/login" className="text-gray-500 hover:text-gray-800">
              Sign in
            </Link>
            <Link
              href="/buyers/signup"
              className="rounded-lg px-4 py-2 font-semibold text-white"
              style={{ backgroundColor: accent }}
            >
              Get your free sheet
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 pt-16">
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: accent }}>
          Contact
        </p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight">
          A human reads every message.
        </h1>

        <div className="mt-8 space-y-4">
          <div className="rounded-xl border border-gray-200 p-6">
            <div className="text-sm font-semibold uppercase tracking-wider text-gray-400">
              Email — anything at all
            </div>
            <a
              href="mailto:leads@greenkeep.us"
              className="mt-1 block text-2xl font-bold"
              style={{ color: accent }}
            >
              leads@greenkeep.us
            </a>
            <p className="mt-2 text-sm text-gray-600">
              Questions about a lead you received, a sheet you bought, pricing, coverage,
              partnerships, or getting your company off our list — one address, answered
              by a person.
            </p>
          </div>

          <div className="rounded-xl border border-gray-200 p-6">
            <div className="text-sm font-semibold uppercase tracking-wider text-gray-400">
              Already have an account?
            </div>
            <p className="mt-2 text-sm text-gray-600">
              The fastest path for lead questions is the chat on your{" "}
              <Link href="/buyers" className="font-semibold underline">buyer dashboard</Link>
              {" "}— it lands with your account context attached.
            </p>
          </div>

          <div className="rounded-xl border border-gray-200 p-6">
            <div className="text-sm font-semibold uppercase tracking-wider text-gray-400">
              Don&apos;t want to hear from us?
            </div>
            <p className="mt-2 text-sm text-gray-600">
              Every email we send has a working one-click unsubscribe, honored instantly
              and permanently. If you&apos;d rather just say it:{" "}
              <a href="mailto:leads@greenkeep.us?subject=Remove%20me" className="underline">
                email us &ldquo;remove me&rdquo;
              </a>{" "}
              and you&apos;re done.
            </p>
          </div>
        </div>

        <div className="mt-12 mb-16 text-center text-sm text-gray-500">
          Curious who we are first? Read <Link href="/about" className="underline">about {brand}</Link>{" "}
          or <Link href="/why" className="underline">the economics</Link>.
        </div>
      </section>

      <SiteFooter name={brand} accent={accent} email={co?.email ?? null} />
    </main>
  );
}
