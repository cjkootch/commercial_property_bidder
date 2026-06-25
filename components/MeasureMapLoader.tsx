"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { MeasureMap as MeasureMapType } from "./MeasureMap";

// mapbox-gl touches `window` at module load, so it must never render on the
// server. dynamic(..., { ssr: false }) is only allowed inside a Client
// Component — hence this thin wrapper, which the server page imports.
const MeasureMap = dynamic(() => import("./MeasureMap").then((m) => m.MeasureMap), {
  ssr: false,
  loading: () => (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="h-[460px] w-full animate-pulse rounded-md bg-gray-100" />
    </div>
  ),
});

export function MeasureMapLoader(props: ComponentProps<typeof MeasureMapType>) {
  return <MeasureMap {...props} />;
}
