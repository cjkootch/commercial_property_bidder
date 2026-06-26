"use client";

import { useState, useTransition } from "react";
import { findPropertyContact, saveSuggestedContact } from "@/app/properties/actions";
import type { ContactSuggestion } from "@/lib/integrations/contact";

/**
 * Free digital-contact finder: OSM POI contact tags + website scrape. The result
 * is a suggestion the operator confirms into a contact (never auto-sent).
 */
export function ContactFinder({
  propertyId,
  suggestion,
}: {
  propertyId: string;
  suggestion: ContactSuggestion | null;
}) {
  const [pending, startTransition] = useTransition();
  const [sug, setSug] = useState<ContactSuggestion | null>(suggestion);
  const [ran, setRan] = useState(false);
  const [saved, setSaved] = useState(false);

  const hasContact = sug && (sug.email || sug.phone);

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Contact (free lookup)</h2>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const next = await findPropertyContact(propertyId);
              setSug(next);
              setRan(true);
              setSaved(false);
            })
          }
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {pending ? "Searching…" : sug ? "Re-run" : "Find contact"}
        </button>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        OpenStreetMap contact tags + website scrape — no paid APIs. A suggestion to
        verify before any outreach.
      </p>

      {sug ? (
        <>
          <dl className="mt-4 space-y-1.5 text-sm">
            <Row label="Name" value={sug.name} />
            <Row label="Email" value={sug.email} />
            <Row label="Phone" value={sug.phone} />
            <Row
              label="Website"
              value={
                sug.website ? (
                  <a href={sug.website} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                    {sug.website}
                  </a>
                ) : null
              }
            />
          </dl>
          {sug.sources.length ? (
            <p className="mt-2 text-xs text-gray-400">source: {sug.sources.join(", ")}</p>
          ) : null}
          {hasContact ? (
            saved ? (
              <span className="mt-3 inline-block rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                Saved as contact
              </span>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await saveSuggestedContact(propertyId, {
                      name: sug.name,
                      email: sug.email,
                      phone: sug.phone,
                    });
                    setSaved(true);
                  })
                }
                className="mt-3 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save as contact"}
              </button>
            )
          ) : null}
        </>
      ) : ran ? (
        <p className="mt-4 text-sm text-gray-400">
          No free contact found in OSM/website. Try Apollo enrichment on the owner, or add manually.
        </p>
      ) : (
        <p className="mt-4 text-sm text-gray-400">Not looked up yet.</p>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-gray-500">{label}</dt>
      <dd className="text-gray-900">{value || "—"}</dd>
    </div>
  );
}
