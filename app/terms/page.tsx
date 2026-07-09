import Link from "next/link";
import { getDefaultCompany } from "@/lib/db/queries";
import { leadMaxBuyers } from "@/lib/leads/availability";
import { Logo } from "@/components/Logo";
import { SiteFooter } from "@/components/SiteFooter";

// Public marketplace terms. The buyer-facing surfaces promise "sold to a
// maximum of 3 companies*" — the asterisk resolves here, where the per-trade
// scoping of the cap, the exclusive option, and the free sheet are spelled
// out in full.
export const dynamic = "force-dynamic";

export default async function TermsPage() {
  const co = await getDefaultCompany();
  const brand = co?.name ?? "Greenkeep";
  const cap = leadMaxBuyers();
  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto max-w-2xl px-6 py-12">
        <Link href="/" className="inline-block">
          <Logo name={brand} />
        </Link>
      <h1 className="mt-8 text-2xl font-semibold text-gray-900">Marketplace terms</h1>
      <p className="mt-2 text-sm text-gray-500">Last updated July 8, 2026</p>

      <section className="mt-8 space-y-6 text-sm leading-relaxed text-gray-700">
        <div>
          <h2 className="text-base font-semibold text-gray-900">1. The {cap}-company cap</h2>
          <p className="mt-2">
            Every job opportunity on the marketplace is sold to a maximum of {cap} companies{" "}
            <strong>within each service trade</strong> (landscaping, pest control, commercial
            cleaning, paving, security, and HVAC are each separate trades, and additional trades
            may be added over time). Companies in different trades do not compete for the same work,
            so a job may be offered to up to {cap} companies in each trade it is relevant to. The
            cap you see on a job — spots taken, spots left — always refers to companies in{" "}
            <em>your</em> trade.
          </p>
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900">2. Exclusive unlocks</h2>
          <p className="mt-2">
            Buying an exclusive closes the job to every other company <strong>in your trade</strong>,
            permanently. It does not restrict companies in other trades, who provide different
            services and would not be bidding against you.
          </p>
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900">3. The free sheet</h2>
          <p className="mt-2">
            One free job sheet per company, subject to availability rules (fresh and headline jobs
            may be paid-only). A free claim uses one of the {cap} spots in your trade.
          </p>
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900">4. What a job sheet is</h2>
          <p className="mt-2">
            Job sheets are compiled from public records and our own aerial measurement. Contract
            values are estimates, not guarantees; you are buying research and timing, not a
            promised contract. Replacement credit may be issued at our discretion when a lead is
            materially wrong.
          </p>
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900">5. Contact</h2>
          <p className="mt-2">
            Questions about these terms: message us from your dashboard{co?.email ? ` or email ${co.email}` : ""}.
          </p>
        </div>
      </section>
      </main>
      <SiteFooter
        name={brand}
        accent={co?.brand_color || "#2f7d4f"}
        email={co?.email ?? null}
      />
    </div>
  );
}
