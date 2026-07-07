import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer } from "@/lib/db/schema";
import { getDefaultCompany } from "@/lib/db/queries";
import { profileComplete } from "@/lib/leads/personalize";
import { currentBuyerId, updateBuyerProfile } from "../actions";
import { Logo } from "@/components/Logo";

// Landscaper profile: the details here auto-fill the intro letter on every job
// sheet (so the outreach is ready to send the moment they open it).
export const dynamic = "force-dynamic";

export default async function BuyerProfile({ searchParams }: { searchParams: { saved?: string } }) {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const [me] = await db.select().from(buyer).where(eq(buyer.id, buyerId!)).limit(1);
  if (!me) redirect("/buyers/login");
  const co = await getDefaultCompany();
  const brand = co?.name ?? "Greenkeep";
  const complete = profileComplete(me);

  const field = (name: string, label: string, value: string | null, placeholder: string, type = "text") => (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <input
        type={type}
        name={name}
        defaultValue={value ?? ""}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
      />
    </label>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3.5">
          <Logo name={brand} />
          <Link href="/buyers" className="text-sm text-gray-500 hover:text-gray-800">
            ← Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Your company profile</h1>
        <p className="mt-1 text-sm text-gray-500">
          These details auto-fill the ready-to-send intro letter on every job sheet — enter them
          once and every lead comes pre-addressed from you.
        </p>

        {searchParams.saved ? (
          <p className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            Saved — your letters are updated.
          </p>
        ) : !complete ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Complete your name, phone, and email so your intro letters are ready to send without
            editing.
          </p>
        ) : null}

        <form action={updateBuyerProfile} className="mt-6 space-y-5">
          <section className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Business</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {field("company_name", "Company name", me.company_name, "Cole's Landscaping")}
              {field("contact_name", "Your name", me.contact_name, "Cole Kootch")}
              {field("phone", "Phone", me.phone, "(281) 555-0100", "tel")}
              {field("website", "Website", me.website, "coleslandscaping.com")}
              {field("license_number", "License # (optional)", me.license_number, "TX-12345")}
              {field("city", "Office city", me.city, "Houston")}
            </div>
            <p className="mt-3 text-xs text-gray-400">
              Sign-in email: <span className="font-medium text-gray-600">{me.email}</span> (this is
              also the [EMAIL] in your letters)
            </p>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Service area & pitch
            </h2>
            <div className="mt-4 space-y-4">
              {field("service_area", "Service area", me.service_area, "Greater Houston, within 30 mi")}
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Short bio (optional)
                </span>
                <textarea
                  name="bio"
                  defaultValue={me.bio ?? ""}
                  rows={3}
                  placeholder="Family-owned, 12 years serving Houston commercial properties…"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
              </label>
            </div>
          </section>

          <button className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">
            Save profile
          </button>
        </form>
      </main>
    </div>
  );
}
