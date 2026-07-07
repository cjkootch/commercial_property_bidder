"use client";

import { useState } from "react";
import { MAP_PX, MAX_RADIUS_MI, pixelsPerMile } from "@/lib/geo/radius";

// Interactive coverage picker: static streets map centered on the landscaper's
// office, an SVG radius circle that scales live with the slider (no refetch),
// and honest recommendations when the radius gets too wide to stay profitable.
export function ServiceRadiusMap(props: {
  lat: number;
  lng: number;
  zoom: number;
  initialRadius: number;
  accent: string;
  mapUrl: string;
}) {
  const [radius, setRadius] = useState(Math.min(MAX_RADIUS_MI, Math.max(2, props.initialRadius)));
  const ppm = pixelsPerMile(props.lat, props.zoom);
  const rPx = radius * ppm;
  const c = MAP_PX / 2;

  const rec = recommendation(radius);

  return (
    <div>
      <div
        className="relative mx-auto overflow-hidden rounded-xl border border-gray-200"
        style={{ width: MAP_PX, maxWidth: "100%", aspectRatio: "1 / 1" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={props.mapUrl} alt="Your service area" className="absolute inset-0 h-full w-full object-cover" />
        <svg viewBox={`0 0 ${MAP_PX} ${MAP_PX}`} className="absolute inset-0 h-full w-full" aria-hidden="true">
          <circle cx={c} cy={c} r={rPx} fill={props.accent} fillOpacity="0.15" stroke={props.accent} strokeWidth="2.5" />
          <circle cx={c} cy={c} r="5" fill={props.accent} stroke="#fff" strokeWidth="2" />
        </svg>
        <div className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-gray-800 shadow">
          {radius} mi radius
        </div>
      </div>

      <input type="hidden" name="service_radius_mi" value={radius} />
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs font-medium text-gray-500">
          <span>How far will you travel?</span>
          <span className="text-sm font-bold text-gray-900">{radius} miles</span>
        </div>
        <input
          type="range"
          min={2}
          max={MAX_RADIUS_MI}
          step={1}
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
          className="mt-2 w-full accent-brand"
          style={{ accentColor: props.accent }}
        />
        <div className="flex justify-between text-[10px] text-gray-400">
          <span>2 mi</span>
          <span>{MAX_RADIUS_MI} mi</span>
        </div>
      </div>

      <div className={`mt-3 rounded-lg border p-3 text-xs ${rec.tone}`}>{rec.text}</div>
    </div>
  );
}

function recommendation(r: number): { text: string; tone: string } {
  if (r <= 20)
    return {
      text: "Tight and efficient — low windshield time means your bids stay competitive and profitable.",
      tone: "border-green-200 bg-green-50 text-green-800",
    };
  if (r <= 35)
    return {
      text: "Solid coverage for commercial routes. Most jobs in this range are worth the drive.",
      tone: "border-gray-200 bg-gray-50 text-gray-600",
    };
  if (r <= 50)
    return {
      text: "Getting wide — past ~35 miles, drive time starts eating your margin. Make sure the contract value justifies the trip (each sheet's bid calculator shows exactly how drive time hits your profit).",
      tone: "border-amber-200 bg-amber-50 text-amber-800",
    };
  return {
    text: "Very wide. At this range you'll spend more time driving than mowing on all but the largest contracts. Consider a second crew hub near your outer jobs instead of stretching one crew across the metro.",
    tone: "border-red-200 bg-red-50 text-red-700",
  };
}
