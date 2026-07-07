"use client";

import { useState } from "react";

// Interactive bid calculator shipped with every job sheet: prefilled from OUR
// measurement and market assumptions, every input editable so the buyer can
// price with THEIR crew reality. Pure client math — nothing leaves the page.
export function BidCalculator(props: {
  accent: string;
  turfSqft: number;
  crewHours: number;
  visitsPerYear: number;
  marketLo: number;
  marketHi: number;
}) {
  const [crewHours, setCrewHours] = useState(props.crewHours);
  const [crewSize, setCrewSize] = useState(2);
  const [hourly, setHourly] = useState(22);
  const [driveMin, setDriveMin] = useState(30);
  const [visits, setVisits] = useState(props.visitsPerYear);
  const [overheadPct, setOverheadPct] = useState(15);
  const [marginPct, setMarginPct] = useState(20);

  // crewHours is total crew-hours on site per visit; drive time applies per
  // crew member.
  const laborPerVisit = crewHours * hourly + (driveMin / 60) * crewSize * hourly;
  const costPerVisit = laborPerVisit * (1 + overheadPct / 100);
  const annualCost = costPerVisit * visits;
  const bidAnnual = annualCost * (1 + marginPct / 100);
  const bidMonthly = bidAnnual / 12;
  const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const inMarket = bidAnnual >= props.marketLo && bidAnnual <= props.marketHi;

  const Field = ({
    label,
    value,
    set,
    step = 1,
    suffix,
  }: {
    label: string;
    value: number;
    set: (n: number) => void;
    step?: number;
    suffix?: string;
  }) => (
    <label className="block">
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</span>
      <span className="mt-1 flex items-center gap-1.5">
        <input
          type="number"
          value={value}
          step={step}
          min={0}
          onChange={(e) => set(Number(e.target.value) || 0)}
          className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-semibold text-gray-900 focus:outline-none"
          style={{ borderColor: undefined }}
        />
        {suffix ? <span className="text-xs text-gray-400">{suffix}</span> : null}
      </span>
    </label>
  );

  return (
    <div>
      <p className="text-xs text-gray-500">
        Prefilled from our measurement ({props.turfSqft.toLocaleString()} sq ft of turf) and
        typical market assumptions — swap in your own numbers to price it your way.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Crew-hrs / visit" value={crewHours} set={setCrewHours} step={0.5} />
        <Field label="Crew size" value={crewSize} set={setCrewSize} />
        <Field label="$ / labor hr" value={hourly} set={setHourly} />
        <Field label="Drive min / visit" value={driveMin} set={setDriveMin} step={5} />
        <Field label="Visits / year" value={visits} set={setVisits} />
        <Field label="Overhead %" value={overheadPct} set={setOverheadPct} />
        <Field label="Margin %" value={marginPct} set={setMarginPct} />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-gray-50 p-4">
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Your cost / visit
          </div>
          <div className="mt-1 text-xl font-bold text-gray-900">{usd(costPerVisit)}</div>
        </div>
        <div className="rounded-xl bg-gray-50 p-4">
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Your cost / year
          </div>
          <div className="mt-1 text-xl font-bold text-gray-900">{usd(annualCost)}</div>
        </div>
        <div className="rounded-xl p-4 text-white" style={{ backgroundColor: props.accent }}>
          <div className="text-[11px] font-medium uppercase tracking-wide text-white/70">
            Suggested bid
          </div>
          <div className="mt-1 text-xl font-extrabold">
            {usd(bidAnnual)}<span className="text-sm font-semibold text-white/80">/yr</span>
          </div>
          <div className="text-xs text-white/80">≈ {usd(bidMonthly)}/mo</div>
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Market range for this site: <strong>{usd(props.marketLo)}–{usd(props.marketHi)}/yr</strong>.{" "}
        {inMarket
          ? "Your bid lands inside it — competitive and profitable."
          : bidAnnual < props.marketLo
            ? "Your bid is under market — room to raise margin and still win."
            : "Your bid is above market — tighten costs or lean on quality in the pitch."}{" "}
        <span className="text-gray-400">Estimates only — confirm scope on site.</span>
      </p>
    </div>
  );
}
