"use client";

import { useState, useTransition } from "react";
import { applyOwnerSuggestion, refreshOwnerSuggestion } from "@/app/properties/actions";
import type { OwnerSuggestion as Suggestion } from "@/lib/integrations/apollo";

/**
 * Shows the suggested ownership company (parcel owner-of-record + Apollo
 * enrichment) and lets the operator confirm it into owner_org with one click.
 * Never writes owner_org automatically — confirmation is explicit (build spec
 * section 9).
 */
export function OwnerSuggestion({
  propertyId,
  ownerOrg,
  suggestion,
}: {
  propertyId: string;
  ownerOrg: string | null;
  suggestion: Suggestion | null;
}) {
  const [pending, startTransition] = useTransition();
  const [sug, setSug] = useState<Suggestion | null>(suggestion);
  const [applied, setApplied] = useState<string | null>(null);

  const currentOwner = applied ?? ownerOrg;
  const matchesCurrent = sug && currentOwner && sug.name.trim() === currentOwner.trim();

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-lg font-medium">Ownership</h2>
      <p className="mt-1 text-sm text-gray-500">
        Owner is operator-confirmed — the suggestion below is from the county owner-of-record
        {sug?.source === "apollo" ? ", enriched via Apollo" : ""}.
      </p>

      <dl className="mt-4 space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-gray-500">Owner (org)</dt>
          <dd className="font-medium text-gray-900">{currentOwner ?? "—"}</dd>
        </div>
      </dl>

      {sug ? (
        <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm">
              <div className="font-medium text-gray-900">{sug.name}</div>
              <div className="mt-0.5 text-xs text-gray-500">
                {[
                  sug.domain,
                  sug.industry,
                  sug.employees ? `${sug.employees.toLocaleString()} emp` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "owner-of-record"}
                {sug.source === "parcel" ? " · not yet enriched" : ""}
              </div>
              {sug.raw_owner !== sug.name ? (
                <div className="mt-0.5 text-xs text-gray-400">deed owner: {sug.raw_owner}</div>
              ) : null}
            </div>
            {matchesCurrent ? (
              <span className="shrink-0 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                Confirmed
              </span>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await applyOwnerSuggestion(propertyId, sug.name);
                    setApplied(sug.name);
                  })
                }
                className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {pending ? "Saving…" : "Use as owner"}
              </button>
            )}
          </div>
          {sug.website ? (
            <a
              href={sug.website}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs text-brand hover:underline"
            >
              {sug.website}
            </a>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-400">
          No owner-of-record found yet (needs a resolved county parcel).
        </p>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const next = await refreshOwnerSuggestion(propertyId);
            setSug(next);
          })
        }
        className="mt-3 text-xs text-gray-500 hover:text-brand disabled:opacity-50"
      >
        {pending ? "…" : "Re-run lookup"}
      </button>
    </section>
  );
}
