import Link from "next/link";
import { getDefaultCompany } from "@/lib/db/queries";
import { Logo } from "@/components/Logo";
import { SiteFooter } from "@/components/SiteFooter";

// Public privacy policy. Written to match what the platform ACTUALLY does —
// account data, Stripe payments (no card storage), email engagement tracking,
// public-records property data, suppression on unsubscribe — no boilerplate
// claims about practices we don't have.
export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const co = await getDefaultCompany();
  const brand = co?.name ?? "Greenkeep";
  const accent = co?.brand_color || "#2f7d4f";
  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto max-w-2xl px-6 py-12">
        <Link href="/" className="inline-block">
          <Logo name={brand} accent={accent} />
        </Link>
        <h1 className="mt-8 text-2xl font-semibold text-gray-900">Privacy policy</h1>
        <p className="mt-2 text-sm text-gray-500">Last updated July 8, 2026</p>

        <section className="mt-8 space-y-6 text-sm leading-relaxed text-gray-700">
          <div>
            <h2 className="text-base font-semibold text-gray-900">What we collect</h2>
            <ul className="mt-2 space-y-2">
              <li>
                <strong>Account information</strong> — company name, email, city/office location,
                service radius, and profile details you provide. Used to run your account, scope
                the leads you see, and personalize your job sheets.
              </li>
              <li>
                <strong>Payments</strong> — processed by Stripe. We never see or store your card
                number; we keep records of what you purchased.
              </li>
              <li>
                <strong>Email engagement</strong> — our emails use open and click tracking (via
                our email provider, Resend) so we know what's working and stop sending what
                isn't. Every marketing email has a one-click unsubscribe; opting out adds you to
                a suppression list we check before every send.
              </li>
              <li>
                <strong>Usage</strong> — pages viewed, leads unlocked, and messages you send us
                through the dashboard chat.
              </li>
            </ul>
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Where lead data comes from</h2>
            <p className="mt-2">
              The properties on our marketplace are compiled from public records (county
              appraisal, permitting, licensing, and municipal data) combined with our own aerial
              measurement. Owner names and mailing addresses in job sheets are public record. We
              are a research service; we do not sell consumer data.
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">What we don&apos;t do</h2>
            <ul className="mt-2 space-y-2">
              <li>• We don&apos;t sell or rent your account information to anyone.</li>
              <li>• We don&apos;t share your purchase history with other buyers.</li>
              <li>
                • Data you enter about your own prospects (the self-serve prospecting tools) stays
                yours — it is never used to train our models or shown to other companies.
              </li>
            </ul>
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Cookies</h2>
            <p className="mt-2">
              We use a session cookie to keep you signed in. No third-party advertising cookies.
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Your choices</h2>
            <p className="mt-2">
              Unsubscribe from any email with one click. To access, correct, or delete your
              account data, contact us{co?.email ? ` at ${co.email}` : " via the dashboard chat"}{" "}
              and we&apos;ll handle it promptly.
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Contact</h2>
            <p className="mt-2">
              {brand}
              {co?.email ? ` · ${co.email}` : ""} · or message us from your dashboard. See also our{" "}
              <Link href="/terms" className="underline">
                marketplace terms
              </Link>
              .
            </p>
          </div>
        </section>
      </main>
      <SiteFooter name={brand} accent={accent} email={co?.email ?? null} />
    </div>
  );
}
