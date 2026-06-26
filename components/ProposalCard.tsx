"use client";

import { useState, useTransition } from "react";
import { createOrUpdateProposal } from "@/app/properties/actions";

type ProposalInfo = {
  slug: string;
  status: string;
  view_count: number;
  last_viewed_at: string | null;
} | null;

/**
 * Operator card for the hosted proposal: create/refresh the shareable link,
 * copy it, and see open tracking. The link renders live data, so "Refresh from
 * latest price" re-points it at the newest pricing without changing the URL.
 */
export function ProposalCard({
  propertyId,
  initial,
  hasPricing,
}: {
  propertyId: string;
  initial: ProposalInfo;
  hasPricing: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [info, setInfo] = useState<ProposalInfo>(initial);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url =
    info && typeof window !== "undefined"
      ? `${window.location.origin}/proposals/${info.slug}`
      : info
        ? `/proposals/${info.slug}`
        : null;

  function createOrRefresh() {
    setError(null);
    startTransition(async () => {
      try {
        const slug = await createOrUpdateProposal(propertyId);
        setInfo((prev) => ({
          slug,
          status: prev?.status ?? "draft",
          view_count: prev?.view_count ?? 0,
          last_viewed_at: prev?.last_viewed_at ?? null,
        }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create proposal.");
      }
    });
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Proposal link</h2>
        <button
          type="button"
          disabled={pending || !hasPricing}
          onClick={createOrRefresh}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {pending ? "Saving…" : info ? "Refresh from latest price" : "Create proposal link"}
        </button>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        A hosted, shareable quote — renders live data (edit/re-price anytime after sending) and
        tracks opens.
      </p>

      {!hasPricing ? (
        <p className="mt-4 text-sm text-gray-400">Price the property first to create a proposal.</p>
      ) : info && url ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={url}
              className="input flex-1 text-sm"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Preview
            </a>
          </div>
          <dl className="flex gap-6 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-500">Status</dt>
              <dd className="font-medium text-gray-900">
                {info.status === "viewed" ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                    Opened
                  </span>
                ) : (
                  info.status
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-500">Opens</dt>
              <dd className="font-medium tabular-nums text-gray-900">{info.view_count}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-500">Last opened</dt>
              <dd className="text-gray-900">
                {info.last_viewed_at ? new Date(info.last_viewed_at).toLocaleString() : "—"}
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-400">No proposal yet.</p>
      )}

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </section>
  );
}
