import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer } from "@/lib/db/schema";
import { getDefaultCompany } from "@/lib/db/queries";
import { profileComplete } from "@/lib/leads/personalize";
import { zoomForRadius } from "@/lib/geo/radius";
import { currentBuyerId, updateBuyerProfile, uploadBuyerLogo } from "../actions";
import { Logo } from "@/components/Logo";
import { ServiceRadiusMap } from "@/components/ServiceRadiusMap";

// Landscaper profile: the details here auto-fill the intro letter on every job
// sheet (so the outreach is ready to send the moment they open it).
export const dynamic = "force-dynamic";

export default async function BuyerProfile({
  searchParams,
}: {
  searchParams: { saved?: string; logoerr?: string };
}) {
  const buyerId = await currentBuyerId();
  if (!buyerId) redirect("/buyers/login");
  const [me] = await db.select().from(buyer).where(eq(buyer.id, buyerId!)).limit(1);
  if (!me) redirect("/buyers/login");
  const co = await getDefaultCompany();
  const brand = co?.name ?? "Greenkeep";
  const accent = co?.brand_color || "#2f7d4f";
  const complete = profileComplete(me);
  const hasLocation = me.lat != null && me.lng != null;
  const mapZoom = hasLocation ? zoomForRadius(me.lat!) : 9;

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

        {/* Logo upload (own form — file upload; also prints on your postcards). */}
        <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Company logo</h2>
          <p className="mt-1 text-xs text-gray-500">
            Shown on your dashboard and printed on the postcards you mail to owners.
          </p>
          <form action={uploadBuyerLogo} className="mt-4 flex flex-wrap items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
              {me.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={me.logo_url} alt="Your logo" className="h-full w-full object-contain" />
              ) : (
                <span className="text-2xl">🌿</span>
              )}
            </div>
            <input
              type="file"
              name="logo"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              required
              className="text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-dark"
            />
            <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              Upload logo
            </button>
          </form>
          {searchParams.logoerr ? (
            <p className="mt-2 text-xs text-red-600">
              {searchParams.logoerr === "toobig"
                ? "That image is over 3 MB — please use a smaller file."
                : searchParams.logoerr === "type"
                  ? "Use a PNG, JPG, WEBP, or SVG."
                  : searchParams.logoerr === "upload"
                    ? "Logo storage isn't set up yet — connect a Vercel Blob store."
                    : searchParams.logoerr === "failed"
                      ? "Upload failed — please try again in a moment."
                      : "Please choose an image."}
            </p>
          ) : null}
        </section>

        <form action={updateBuyerProfile} className="mt-5 space-y-5">
          <section className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Business</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {field("company_name", "Company name", me.company_name, "Cole's Landscaping")}
              {field("contact_name", "Your name", me.contact_name, "Cole Kootch")}
              {field("phone", "Phone", me.phone, "(281) 555-0100", "tel")}
              {field("website", "Website", me.website, "coleslandscaping.com")}
              {field("license_number", "License # (optional)", me.license_number, "TX-12345")}
            </div>
            <p className="mt-3 text-xs text-gray-400">
              Sign-in email: <span className="font-medium text-gray-600">{me.email}</span> (this is
              also the [EMAIL] in your letters)
            </p>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Office & service area
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              We center your job matches and distances on this address. Drag the slider to set how
              far you&apos;ll travel.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-[2fr_1fr]">
              {field("address", "Office address", me.address, "123 Main St")}
              {field("city", "City", me.city, "Houston")}
            </div>

            {hasLocation ? (
              <div className="mt-5">
                <ServiceRadiusMap
                  lat={me.lat!}
                  lng={me.lng!}
                  zoom={mapZoom}
                  initialRadius={me.service_radius_mi}
                  accent={accent}
                  mapUrl={`/api/area-map?lng=${me.lng}&lat=${me.lat}&zoom=${mapZoom}`}
                />
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
                Enter your office address and save — your coverage map appears here.
                <input type="hidden" name="service_radius_mi" value={me.service_radius_mi} />
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              About you (optional)
            </h2>
            <label className="mt-4 block">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Short bio
              </span>
              <textarea
                name="bio"
                defaultValue={me.bio ?? ""}
                rows={3}
                placeholder="Family-owned, 12 years serving Houston commercial properties…"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
            </label>
          </section>

          <button className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">
            Save profile
          </button>
        </form>
      </main>
    </div>
  );
}
