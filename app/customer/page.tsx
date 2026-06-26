import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CUSTOMER_COOKIE, verifyToken } from "@/lib/customer-auth";
import { getCustomerProposals, getDefaultCompany } from "@/lib/db/queries";
import { acceptProposal, requestWalkthrough, customerLogout } from "./actions";
import { usd } from "@/lib/format";

// Customer portal (magic-link authenticated): view proposals, accept, or request
// a walkthrough. Session is verified here; an invalid/expired cookie bounces to
// the login page.
export const dynamic = "force-dynamic";

export default async function CustomerPortal() {
  const email = verifyToken(cookies().get(CUSTOMER_COOKIE)?.value, "session");
  if (!email) redirect("/customer/login");

  const co = await getDefaultCompany();
  const accent = co?.brand_color || "#2f7d4f";
  const proposals = await getCustomerProposals(email);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold" style={{ color: accent }}>
            {co?.name ?? "Greenkeep"}
          </Link>
          <form action={customerLogout}>
            <button className="text-sm text-gray-500 hover:text-gray-800">Sign out</button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Your proposals</h1>
        <p className="mt-1 text-sm text-gray-500">Signed in as {email}</p>

        {proposals.length === 0 ? (
          <p className="mt-8 rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
            No proposals are linked to this email yet. If you were expecting one, contact us and
            we&apos;ll get it over to you.
          </p>
        ) : (
          <div className="mt-6 space-y-4">
            {proposals.map((p) => {
              const accepted = !!p.accepted_at;
              const requested = !!p.walkthrough_requested_at;
              return (
                <div key={p.slug} className="rounded-xl border border-gray-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium text-gray-900">{p.property_name}</div>
                      <div className="mt-1 text-sm text-gray-500">
                        {p.monthly_price != null ? `${usd(p.monthly_price, { cents: false })}/mo` : "Pricing pending"}
                        {p.annual_price != null ? ` · ${usd(p.annual_price, { cents: false })}/yr` : ""}
                      </div>
                    </div>
                    {accepted ? (
                      <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                        Accepted
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Link
                      href={`/proposals/${p.slug}`}
                      target="_blank"
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      View proposal
                    </Link>

                    {!accepted ? (
                      <form action={acceptProposal.bind(null, p.slug)}>
                        <button
                          className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
                          style={{ backgroundColor: accent }}
                        >
                          Accept proposal
                        </button>
                      </form>
                    ) : null}

                    {requested ? (
                      <span className="text-sm text-gray-500">Walkthrough requested ✓</span>
                    ) : (
                      <form action={requestWalkthrough.bind(null, p.slug)}>
                        <button className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                          Request a walkthrough
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
