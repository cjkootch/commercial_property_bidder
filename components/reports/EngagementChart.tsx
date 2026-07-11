"use client";

import { useState } from "react";
import type { EngagementBucket } from "@/lib/reports/data";

// Daily engagement chart (GA-style): grouped bars per day for sends / opens /
// clicks. Palette validated with the dataviz six-checks script against the
// light surface: green #2f7d4f, blue #2563eb, amber #b45309 — fixed series
// order, never cycled. Inline SVG, no chart lib.

const SERIES = [
  { key: "sends", label: "Sends", color: "#2f7d4f" },
  { key: "opens", label: "Opens", color: "#2563eb" },
  { key: "clicks", label: "Clicks", color: "#b45309" },
] as const;

const W = 860;
const H = 240;
const PAD = { top: 12, right: 8, bottom: 24, left: 36 };

export function EngagementChart({ buckets }: { buckets: EngagementBucket[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(1, ...buckets.flatMap((b) => [b.sends, b.opens, b.clicks]));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const groupW = plotW / buckets.length;
  // Thin marks with a 2px surface gap between adjacent bars.
  const barW = Math.max(2, Math.min(14, (groupW - 8) / SERIES.length - 2));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  // Recessive grid: 3 lines at rounded values.
  const gridVals = [Math.round(max / 3), Math.round((2 * max) / 3), max];

  // Sparse x labels — every bucket label would collide.
  const step = Math.max(1, Math.ceil(buckets.length / 7));

  const hovered = hover != null ? buckets[hover] : null;

  return (
    <div>
      {/* Legend: 3 series → always present; text in ink, chip carries color. */}
      <div className="mb-2 flex items-center gap-4 text-xs text-gray-600">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Daily email engagement">
          {gridVals.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="#e5e7eb" strokeWidth="1" />
              <text x={PAD.left - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="#9ca3af">
                {v}
              </text>
            </g>
          ))}
          <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="#d1d5db" strokeWidth="1" />

          {buckets.map((b, i) => {
            const gx = PAD.left + i * groupW;
            const total = SERIES.length * (barW + 2) - 2;
            const start = gx + (groupW - total) / 2;
            return (
              <g key={b.label}>
                {/* Hover hit target spans the whole group column. */}
                <rect
                  x={gx}
                  y={PAD.top}
                  width={groupW}
                  height={plotH}
                  fill={hover === i ? "#f3f4f6" : "transparent"}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
                {SERIES.map((s, si) => {
                  const v = b[s.key];
                  const barH = Math.max(v > 0 ? 2 : 0, (v / max) * plotH);
                  return (
                    <rect
                      key={s.key}
                      x={start + si * (barW + 2)}
                      y={PAD.top + plotH - barH}
                      width={barW}
                      height={barH}
                      rx={2}
                      fill={s.color}
                      pointerEvents="none"
                    />
                  );
                })}
                {i % step === 0 ? (
                  <text
                    x={gx + groupW / 2}
                    y={H - 8}
                    textAnchor="middle"
                    fontSize="10"
                    fill="#9ca3af"
                  >
                    {b.label.replace(/^Wk of /, "").slice(5)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>

        {hovered ? (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs shadow-md"
            style={{
              left: `${Math.min(85, ((hover! + 0.5) / buckets.length) * 100)}%`,
            }}
          >
            <div className="mb-1 font-medium text-gray-800">{hovered.label}</div>
            {SERIES.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5 text-gray-600">
                <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                {s.label}: <span className="font-medium tabular-nums">{hovered[s.key]}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Accessibility fallback: the same data as a table. */}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600">
          View as table
        </summary>
        <table className="mt-2 text-xs text-gray-600">
          <thead>
            <tr className="text-left text-gray-400">
              <th className="pr-4 font-medium">Date</th>
              <th className="pr-4 font-medium">Sends</th>
              <th className="pr-4 font-medium">Opens</th>
              <th className="font-medium">Clicks</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.label}>
                <td className="pr-4">{b.label}</td>
                <td className="pr-4 tabular-nums">{b.sends}</td>
                <td className="pr-4 tabular-nums">{b.opens}</td>
                <td className="tabular-nums">{b.clicks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
