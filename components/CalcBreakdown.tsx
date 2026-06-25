import type { PricingBreakdown, PricingResult } from "@/lib/pricing/types";
import { usd, pct } from "@/lib/format";

// Step-by-step audit of how measurements become a price (build spec section
// 5.2). Pure presentational; the page computes the breakdown via
// computePricing(..., { breakdown: true }).

function Row({
  label,
  formula,
  value,
}: {
  label: string;
  formula: string;
  value: string;
}) {
  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="py-1.5 pr-3 align-top text-gray-700">{label}</td>
      <td className="py-1.5 pr-3 align-top font-mono text-xs text-gray-400">{formula}</td>
      <td className="py-1.5 text-right align-top font-medium tabular-nums">{value}</td>
    </tr>
  );
}

export function CalcBreakdown({
  result,
  breakdown,
}: {
  result: PricingResult;
  breakdown: PricingBreakdown;
}) {
  const b = breakdown;
  const min1 = (n: number) => n.toFixed(1);
  const min2 = (n: number) => n.toFixed(2);

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-lg font-medium">How this price is calculated</h2>
      <p className="mt-1 text-sm text-gray-500">
        Each step uses the active pricing config. Audit any value against the inputs above.
      </p>
      <table className="mt-4 w-full text-sm">
        <tbody>
          <Row
            label="Turf area"
            formula="turf_sqft ÷ 43,560"
            value={`${min2(b.turf_acres)} ac`}
          />
          <Row
            label="Turf time"
            formula={`acres × turf_min/ac × ${min2(b.complexity)}`}
            value={`${min1(b.turf_time)} min`}
          />
          <Row
            label="Bed time"
            formula={`(bed_sqft ÷ 1000) × bed_min × ${min2(b.complexity)}`}
            value={`${min1(b.bed_time)} min`}
          />
          <Row
            label="Fixed + drive"
            formula="per-stop overhead"
            value={`${min1(b.fixed_min_per_stop + b.drive_min_per_stop)} min`}
          />
          <Row
            label="Total crew time"
            formula="sum of the above"
            value={`${min1(b.total_crew_min)} min`}
          />
          <Row
            label="Crew-hours / visit"
            formula="total_min ÷ 60"
            value={`${min2(b.crew_hours_per_visit)} h`}
          />
          <Row
            label="Cost / visit"
            formula={`crew-hours × ${usd(b.crew_cost_per_hour)}/h`}
            value={usd(b.cost_per_visit)}
          />
          <Row
            label="Price before floor"
            formula={`cost ÷ (1 − ${pct(b.target_margin)})`}
            value={usd(b.price_before_floor)}
          />
          <Row
            label="Price / visit"
            formula={
              b.price_floored
                ? `floored at ${usd(b.min_price_per_visit)} minimum`
                : "target-margin price"
            }
            value={usd(result.price_per_visit)}
          />
          <Row
            label="Gross margin"
            formula="(price − cost) ÷ price"
            value={pct(result.gross_margin_pct)}
          />
          <Row
            label="Monthly / Annual"
            formula="price × visits/yr ÷ 12  ·  × visits/yr"
            value={`${usd(result.monthly_price)} / ${usd(result.annual_price)}`}
          />
          <Row
            label="Cole annual cut"
            formula="annual gross profit × share"
            value={usd(result.cole_annual_cut)}
          />
        </tbody>
      </table>
    </section>
  );
}
