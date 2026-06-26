"use client";

import { useState, useTransition } from "react";
import { screenProperty, type GrassScreenResult } from "@/app/properties/actions";

/**
 * Sourcing pre-screen card: runs the cheap RGB vegetation estimate over the
 * parcel and shows whether the property clears the grass-coverage gate before
 * committing to a full measure & quote. The persisted value renders on first
 * load; "Re-screen" recomputes it.
 */
export function GrassScreen({
  propertyId,
  initialFraction,
  threshold,
}: {
  propertyId: string;
  initialFraction: number | null;
  threshold: number;
}) {
  const [pending, startTransition] = useTransition();
  const [fraction, setFraction] = useState<number | null>(initialFraction);
  const [error, setError] = useState<string | null>(null);

  const thresholdPct = Math.round(threshold * 100);
  const hasValue = typeof fraction === "number" && Number.isFinite(fraction);
  const qualified = hasValue && (fraction as number) >= threshold;

  function run() {
    setError(null);
    startTransition(async () => {
      const res: GrassScreenResult | null = await screenProperty(propertyId);
      if (!res) {
        setError("Couldn't screen — needs a geocoded address, a county parcel, and a Mapbox token.");
        return;
      }
      setFraction(res.grass_fraction);
    });
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Grass pre-screen</h2>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {pending ? "Screening…" : hasValue ? "Re-screen" : "Run screen"}
        </button>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Approximate vegetated (≈ grass) coverage of the parcel from satellite imagery. A property is
        suggested when coverage is at least {thresholdPct}%. Includes tree canopy and beds — a coarse
        gate, not the serviceable measurement.
      </p>

      {hasValue ? (
        <div className="mt-4 flex items-center gap-4">
          <div className="text-3xl font-semibold tabular-nums text-gray-900">
            {Math.round((fraction as number) * 100)}%
          </div>
          <span
            className={
              qualified
                ? "rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800"
                : "rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-600"
            }
          >
            {qualified ? "Qualified" : `Below ${thresholdPct}% threshold`}
          </span>
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-400">Not screened yet.</p>
      )}

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </section>
  );
}
