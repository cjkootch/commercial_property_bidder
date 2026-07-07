"use client";

import { useTransition } from "react";

// The buyer's outreach pipeline on a lead — Greenkeep as their CRM. Clicking a
// stage sets it (server action revalidates); Won/Lost are terminal. Timeline +
// note form are rendered by the server page beneath this.
const STEPS: { key: string; label: string }[] = [
  { key: "new", label: "New" },
  { key: "letter_sent", label: "Letter sent" },
  { key: "postcard_sent", label: "Postcard mailed" },
  { key: "contacted", label: "Contacted" },
  { key: "bidding", label: "Bidding" },
];

export function OutreachTracker(props: {
  unlockId: string;
  status: string;
  accent: string;
  onSet: (unlockId: string, status: string) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  const idx = STEPS.findIndex((s) => s.key === props.status);
  const terminal = props.status === "won" || props.status === "lost";

  const set = (status: string) => start(() => void props.onSet(props.unlockId, status));

  return (
    <div className={pending ? "opacity-60" : ""}>
      <div className="flex flex-wrap items-center gap-1.5">
        {STEPS.map((s, i) => {
          const active = props.status === s.key;
          const done = !terminal && i < idx;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => set(s.key)}
              disabled={pending}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? "text-white"
                  : done
                    ? "bg-brand/10 text-brand"
                    : "border border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}
              style={active ? { backgroundColor: props.accent } : undefined}
            >
              {done ? "✓ " : ""}
              {s.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-gray-400">Outcome:</span>
        <button
          type="button"
          onClick={() => set("won")}
          disabled={pending}
          className={`rounded-full px-3 py-1.5 text-xs font-bold ${
            props.status === "won" ? "bg-green-600 text-white" : "bg-green-50 text-green-700 hover:bg-green-100"
          }`}
        >
          🏆 Won it
        </button>
        <button
          type="button"
          onClick={() => set("lost")}
          disabled={pending}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
            props.status === "lost" ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
          }`}
        >
          Lost
        </button>
      </div>
    </div>
  );
}
