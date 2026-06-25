import Link from "next/link";
import { createProperty } from "../actions";

export const dynamic = "force-dynamic";

const ICP_OPTIONS: [string, string][] = [
  ["self_storage", "Self-storage"],
  ["office_park", "Office / flex park"],
  ["medical", "Medical office"],
  ["church", "Church"],
  ["daycare", "Daycare / school"],
  ["retail_strip", "Retail strip"],
  ["industrial", "Industrial"],
  ["other", "Other"],
];

export default function NewPropertyPage() {
  return (
    <div className="max-w-xl">
      <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand">
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Add property</h1>
      <p className="mt-1 text-sm text-gray-500">
        Enter the basics. You&apos;ll add measurements and price it on the next screen.
      </p>

      <form action={createProperty} className="mt-6 space-y-4">
        <Field label="Property name" required>
          <input name="name" required className="input" placeholder="249 Self-Storage" />
        </Field>
        <Field label="Address">
          <input name="address" className="input" placeholder="SH-249" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="City">
            <input name="city" className="input" placeholder="Tomball" />
          </Field>
          <Field label="ZIP">
            <input name="zip" className="input" placeholder="77375" />
          </Field>
        </div>
        <Field label="Property type">
          <select name="icp_type" defaultValue="self_storage" className="input">
            {ICP_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Owner / grounds-controlling entity"
          hint="Who controls grounds maintenance. Required before contact enrichment."
        >
          <input name="owner_org" className="input" placeholder="249 Storage Partners LLC" />
        </Field>

        <button
          type="submit"
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
        >
          Create property
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      <div className="mt-1">{children}</div>
      {hint ? <span className="mt-1 block text-xs text-gray-500">{hint}</span> : null}
    </label>
  );
}
