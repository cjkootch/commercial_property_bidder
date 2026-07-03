import Link from "next/link";
import { resolveTenant } from "@/lib/tenant";
import { MarketingShell, type Brand } from "@/components/MarketingShell";
import { submitQuoteRequest } from "./actions";

// Public quote-intake. One page, segment-aware via ?type=residential|commercial.
export const dynamic = "force-dynamic";

export default async function QuotePage({
  searchParams,
}: {
  searchParams: { type?: string; sent?: string; error?: string };
}) {
  const co = await resolveTenant();
  const brand: Brand = {
    name: co?.name ?? "Greenkeep",
    accent: co?.brand_color || "#2f7d4f",
    phone: co?.phone ?? null,
    email: co?.email ?? null,
  };
  const { accent } = brand;
  const type = searchParams.type === "commercial" ? "commercial" : "residential";
  const commercial = type === "commercial";

  return (
    <MarketingShell brand={brand} active={commercial ? "commercial" : "residential"}>
      <section className="mx-auto max-w-xl px-6 py-14">
        {searchParams.sent ? (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
            <h1 className="text-2xl font-semibold text-green-900">Thanks — we&apos;ve got it.</h1>
            <p className="mt-2 text-green-800">
              We&apos;ll review your property and follow up with a detailed proposal shortly.
            </p>
            <Link href="/" className="mt-6 inline-block text-sm font-medium" style={{ color: accent }}>
              ← Back to home
            </Link>
          </div>
        ) : (
          <>
            <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
              {commercial ? `${brand.name} Commercial` : `${brand.name} Residential`}
            </span>
            <h1 className="mt-1 text-3xl font-bold">
              {commercial ? "Request a proposal" : "Get your free quote"}
            </h1>
            <p className="mt-2 text-gray-600">
              {commercial
                ? "Tell us about the property (or portfolio) and we'll send an itemized, measured proposal."
                : "A few details and we'll send a simple flat-rate quote — usually within a day."}
            </p>

            {searchParams.error ? (
              <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Please include a property address and either an email or phone.
              </p>
            ) : null}

            <form action={submitQuoteRequest} className="mt-6 space-y-4">
              <input type="hidden" name="type" value={type} />
              {/* Honeypot — hidden from humans, catches bots. */}
              <input
                type="text"
                name="website_hp"
                tabIndex={-1}
                autoComplete="off"
                className="hidden"
                aria-hidden="true"
              />

              {commercial ? (
                <Field name="org_name" label="Business / property name" placeholder="e.g. Cypress Office Park" />
              ) : null}

              <div className="grid grid-cols-2 gap-4">
                <Field name="contact_name" label="Your name" placeholder="Full name" />
                <Field name="phone" label="Phone" placeholder="(281) 555-0123" />
              </div>
              <Field name="email" label="Email" type="email" placeholder="you@example.com" />
              <Field name="address" label="Property address" placeholder="Street address" required />
              <div className="grid grid-cols-2 gap-4">
                <Field name="city" label="City" placeholder="City" />
                <Field name="zip" label="ZIP" placeholder="ZIP" />
              </div>

              {commercial ? (
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Property type</span>
                  <select name="icp_type" className="input mt-1" defaultValue="office_park">
                    <option value="office_park">Office park</option>
                    <option value="retail_strip">Retail / strip center</option>
                    <option value="self_storage">Self-storage</option>
                    <option value="medical">Medical</option>
                    <option value="church">Church</option>
                    <option value="daycare">Daycare / school</option>
                    <option value="industrial">Industrial</option>
                    <option value="other">Other</option>
                  </select>
                </label>
              ) : null}

              <label className="block">
                <span className="text-sm font-medium text-gray-700">Anything else?</span>
                <textarea name="notes" rows={3} className="input mt-1" placeholder="Gate codes, problem areas, timing…" />
              </label>

              <button
                type="submit"
                className="w-full rounded-lg px-5 py-3 text-sm font-medium text-white"
                style={{ backgroundColor: accent }}
              >
                {commercial ? "Request proposal" : "Get my quote"}
              </button>
              <p className="text-center text-xs text-gray-400">
                No obligation. We&apos;ll only use your details to prepare and send your quote.
              </p>
            </form>
          </>
        )}
      </section>
    </MarketingShell>
  );
}

function Field({
  name,
  label,
  placeholder,
  type = "text",
  required,
}: {
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">
        {label}
        {required ? " *" : ""}
      </span>
      <input type={type} name={name} placeholder={placeholder} required={required} className="input mt-1" />
    </label>
  );
}
