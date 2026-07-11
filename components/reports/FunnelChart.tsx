import type { FunnelStage } from "@/lib/reports/data";

// Conversion funnel — horizontal bars, sequential single-hue ramp (magnitude,
// not identity: light→dark brand green), each stage showing count + % of the
// stage above. Server-rendered; native title tooltips carry the stage notes.

const RAMP = ["#8fc0a6", "#6fae8e", "#529c77", "#3d8b61", "#2f7d4f", "#256842", "#1c5335"];

export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(1, stages[0]?.value ?? 1);
  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const conv = prev ? Math.round((s.value / prev) * 100) : null;
        const w = Math.max(s.value > 0 ? 2 : 0, (s.value / max) * 100);
        return (
          <div key={s.label} title={s.note ? `${s.label} (${s.note})` : s.label}>
            <div className="mb-0.5 flex items-baseline justify-between text-xs">
              <span className="text-gray-600">{s.label}</span>
              <span className="text-gray-800">
                <span className="font-semibold tabular-nums">{s.value.toLocaleString()}</span>
                {conv != null ? (
                  <span className="ml-1.5 tabular-nums text-gray-400">{conv}%</span>
                ) : null}
              </span>
            </div>
            <div className="h-4 rounded-sm bg-gray-100">
              <div
                className="h-4 rounded-sm"
                style={{ width: `${w}%`, background: RAMP[Math.min(i, RAMP.length - 1)] }}
              />
            </div>
          </div>
        );
      })}
      <p className="pt-1 text-[11px] leading-4 text-gray-400">
        Cohort = campaign offers sent this period. Later stages (claim views, signups, unlocks)
        count events in the period, so a signup can trace to an earlier send.
      </p>
    </div>
  );
}
