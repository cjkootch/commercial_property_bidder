import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, prospect } from "@/lib/db/schema";
import { getDefaultCompany } from "@/lib/db/queries";
import { Logo } from "@/components/Logo";
import { currentBuyerId } from "../actions";
import { addProspects } from "./actions";

// Self-serve prospecting: a buyer adds their own target addresses; we scan,
// quote, and let them mail a branded postcard that drives to a hosted microsite.
export const dynamic = "force-dynamic";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

const STATUS: Record<string, { label: string; cls: string }> = {
  added: { label: "Queued", cls: "bg-gray-100 text-gray-600" },
  scanned: { label: "Scanned", cls: "bg-blue-100 text-blue-700" },
  mailed: { label: "Postcard mailed", cls: "bg-amber-100 text-amber-800" },
  viewed: { label: "Opened quote", cls: "bg-green-100 text-green-700" },
  archived: { label: "Archived", cls: "bg-gray-100 text-gray-400" },
};

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: { added?: string; err?: string };
}) {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const [me] = await db.select().from(buyer).where(eq(buyer.id, buyerId!)).limit(1);
  if (!me) redirect("/buyers/login");
  const co = await getDefaultCompany();
  const brand = co?.name ?? "Greenkeep";

  const rows = await db
    .select()
    .from(prospect)
    .where(eq(prospect.buyer_id, buyerId!))
    .orderBy(desc(prospect.created_at));

  const needsOffice = !me.address || !me.city || !me.zip;

  const monthlyOf = (p: (typeof rows)[number]) =>
    p.price_override_cents != null
      ? p.price_override_cents / 100
      : p.monthly_price ?? null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
          <Logo name={brand} />
          <Link href="/buyers" className="text-sm text-gray-500 hover:text-gray-800">
            ← Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Your prospects</h1>
        <p className="mt-1 text-sm text-gray-500">
          Add any commercial property you want to win. We measure it from above, estimate the
          contract, and let you mail a branded postcard that sends the owner to your own quote page.
        </p>

        {searchParams.added ? (
          <p className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            Added {searchParams.added} propert{searchParams.added === "1" ? "y" : "ies"} — open one to
            see its measurement and estimate.
          </p>
        ) : searchParams.err === "empty" ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Enter at least one address.
          </p>
        ) : searchParams.err === "rate" ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Too many additions in a short window — try again shortly.
          </p>
        ) : null}

        {needsOffice ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Add your office address in{" "}
            <Link href="/buyers/profile" className="font-semibold underline">
              your profile
            </Link>{" "}
            before mailing — it&apos;s the postcard&apos;s return address.
          </p>
        ) : null}

        {/* Add addresses */}
        <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Add addresses
          </h2>
          <form action={addProspects} className="mt-4 grid gap-4">
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Property address
                </span>
                <input
                  name="address"
                  placeholder="1500 Main St"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  City
                </span>
                <input
                  name="city"
                  placeholder="Houston"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Name (optional)
                </span>
                <input
                  name="name"
                  placeholder="Oak Center"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
              </label>
            </div>
            <div className="text-center text-xs font-semibold uppercase tracking-wide text-gray-400">
              or paste a list
            </div>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Bulk add — one address per line (up to 50)
              </span>
              <textarea
                name="addresses"
                rows={4}
                placeholder={"1500 Main St, Houston, TX\n820 Gessner Rd, Houston, TX"}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
            </label>
            <div>
              <button className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">
                Add &amp; scan
              </button>
            </div>
          </form>
        </section>

        {/* Prospect list */}
        <section className="mt-8">
          {rows.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-300 bg-white/50 p-8 text-center text-sm text-gray-500">
              No prospects yet. Add an address above to measure and quote it.
            </p>
          ) : (
            <ul className="grid gap-3">
              {rows.map((p) => {
                const s = STATUS[p.status] ?? STATUS.added;
                const monthly = monthlyOf(p);
                return (
                  <li
                    key={p.id}
                    className={`rounded-xl border border-gray-200 bg-white p-4 ${
                      p.status === "archived" ? "opacity-60" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/buyers/prospects/${p.id}`}
                            className="truncate font-semibold text-gray-900 hover:text-brand"
                          >
                            {p.name || p.address}
                          </Link>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>
                            {s.label}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-gray-500">
                          {p.address}
                          {p.city ? `, ${p.city}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-5 text-right">
                        <div>
                          <div className="text-sm font-semibold text-gray-900">
                            {monthly != null ? `${usd(monthly)}/mo` : "—"}
                          </div>
                          <div className="text-[11px] uppercase tracking-wide text-gray-400">
                            est. contract
                          </div>
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-gray-900">{p.view_count}</div>
                          <div className="text-[11px] uppercase tracking-wide text-gray-400">
                            quote opens
                          </div>
                        </div>
                        <Link
                          href={`/buyers/prospects/${p.id}`}
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          Open
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
