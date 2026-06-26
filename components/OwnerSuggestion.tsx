"use client";

import { useState, useTransition } from "react";
import { applyOwnerSuggestion, enrichOwnerWithApollo, setActivelyLeasing } from "@/app/properties/actions";
import type { OwnerSuggestion as Suggestion } from "@/lib/integrations/apollo";
import { isRecentOwnerChange, monthsSince, RECENT_OWNER_MONTHS } from "@/lib/sourcing/criteria";

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
  lastSaleDate,
  activelyLeasing,
}: {
  propertyId: string;
  ownerOrg: string | null;
  suggestion: Suggestion | null;
  lastSaleDate?: string | null;
  activelyLeasing?: boolean;
}) {
  const recentChange = isRecentOwnerChange(lastSaleDate);
  const months = monthsSince(lastSaleDate);
  const [leasing, setLeasing] = useState(!!activelyLeasing);
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
        {lastSaleDate ? (
          <div className="flex items-center gap-2">
            <dt className="w-28 shrink-0 text-gray-500">Owner since</dt>
            <dd className="text-gray-900">
              {lastSaleDate}
              {recentChange ? (
                <span
                  className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                  title={`Ownership changed within ${RECENT_OWNER_MONTHS} months — new owners often re-bid grounds vendors`}
                >
                  Recent owner change{months != null ? ` · ${months} mo` : ""}
                </span>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>

      {sug ? (
        <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm">
              <div className="font-medium text-gray-900">{sug.name}</div>
              <div className="mt-0.5 text-xs text-gray-500">
                {[sug.domain, sug.revenue ? `rev ${sug.revenue}` : null]
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

      <label className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-3 text-sm">
        <input
          type="checkbox"
          checked={leasing}
          disabled={pending}
          onChange={(e) => {
            const v = e.target.checked;
            setLeasing(v);
            startTransition(() => setActivelyLeasing(propertyId, v));
          }}
          className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
        />
        <span className="text-gray-700">
          Actively leasing / new property manager
          <span className="text-gray-400"> — buying signal</span>
        </span>
      </label>

      {sug ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const next = await enrichOwnerWithApollo(propertyId);
              if (next) setSug(next);
            })
          }
          className="mt-3 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {pending
            ? "Enriching…"
            : sug.source === "apollo"
              ? "Re-enrich via Apollo (1 credit)"
              : "Enrich via Apollo (1 credit)"}
        </button>
      ) : null}
    </section>
  );
}
