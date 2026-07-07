"use client";

import { useState } from "react";

// Bid calculator shipped with every job sheet. The MARKET RANGE is the price
// anchor (it comes from our measurement); the calculator answers "what would
// I make at that price with MY crew?" — bid prefills to the market midpoint,
// costs prefill to loaded commercial defaults, everything editable. Pure
// client math — nothing leaves the page.
export function BidCalculator(props: {
  accent: string;
  turfSqft: number;
  crewHours: number;
  visitsPerYear: number;
  marketLo: number;
  marketHi: number;
  /** Round-trip drive minutes prefill (from the sheet's measured drive time). */
  driveMinutes?: number;
}) {
  const mid = Math.round((props.marketLo + props.marketHi) / 2 / 100) * 100;
  const [crewHours, setCrewHours] = useState(props.crewHours);
  const [crewSize, setCrewSize] = useState(2);
  const [hourly, setHourly] = useState(45); // loaded: wage + burden + equipment + fuel
  const [driveMin, setDriveMin] = useState(props.driveMinutes ?? 30);
  const [visits, setVisits] = useState(props.visitsPerYear);
  const [overheadPct, setOverheadPct] = useState(25);
  const [bid, setBid] = useState(mid);

  // crewHours = total crew-hours on site per visit; drive time per crew member.
  const laborPerVisit = crewHours * hourly + (driveMin / 60) * crewSize * hourly;
  const costPerVisit = laborPerVisit * (1 + overheadPct / 100);
  const annualCost = costPerVisit * visits;
  const profit = bid - annualCost;
  const marginPct = bid > 0 ? (profit / bid) * 100 : 0;
  const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

  const verdict =
    profit <= 0
      ? "That bid loses money with these costs — tighten the inputs or walk."
      : marginPct >= 45
        ? "Healthy margin — you can sharpen the bid to win and still profit."
        : marginPct >= 25
          ? "Solid, sustainable margin for commercial work."
          : "Thin margin — consider bidding higher in the range or trimming drive time.";

  const Field = ({
    label,
    value,
    set,
    step = 1,
  }: {
    label: string;
    value: number;
    set: (n: number) => void;
    step?: number;
  }) => (
    <label className="block">
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={0}
        onChange={(e) => set(Number(e.target.value) || 0)}
        className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-semibold text-gray-900 focus:outline-none"
      />
    </label>
  );

  return (
    <div>
      <p className="text-xs text-gray-500">
        Market range from our measurement ({props.turfSqft.toLocaleString()} sq ft of turf):{" "}
        <strong>
          {usd(props.marketLo)}–{usd(props.marketHi)}/yr
        </strong>
        . Set your bid inside it, plug in your crew costs, and see what you&apos;d keep.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="col-span-2 block">
          <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Your bid ($/yr)
          </span>
          <input
            type="number"
            value={bid}
            step={500}
            min={0}
            onChange={(e) => setBid(Number(e.target.value) || 0)}
            className="mt-1 w-full rounded-md border-2 px-2.5 py-1.5 text-base font-bold text-gray-900 focus:outline-none"
            style={{ borderColor: props.accent }}
          />
        </label>
        <Field label="Crew-hrs / visit" value={crewHours} set={setCrewHours} step={0.5} />
        <Field label="Visits / year" value={visits} set={setVisits} />
        <Field label="Crew size" value={crewSize} set={setCrewSize} />
        <Field label="$ / crew-hr (loaded)" value={hourly} set={setHourly} />
        <Field label="Drive min / visit" value={driveMin} set={setDriveMin} step={5} />
        <Field label="Overhead %" value={overheadPct} set={setOverheadPct} />
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
        <div
          className="rounded-xl p-4 text-white"
          style={{ backgroundColor: profit > 0 ? props.accent : "#b91c1c" }}
        >
          <div className="text-[11px] font-medium uppercase tracking-wide text-white/70">
            Profit at your bid
          </div>
          <div className="mt-1 text-xl font-extrabold">
            {usd(profit)}<span className="text-sm font-semibold text-white/80">/yr</span>
          </div>
          <div className="text-xs text-white/80">{Math.round(marginPct)}% margin</div>
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        {verdict} <span className="text-gray-400">Loaded $/crew-hr should cover wage, burden, equipment, and fuel. Estimates only — confirm scope on site.</span>
      </p>
    </div>
  );
}
