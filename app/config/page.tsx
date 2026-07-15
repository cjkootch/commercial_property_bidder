import { getActiveConfig, getDefaultCompany, toEngineConfig } from "@/lib/db/queries";
import { CommFlow } from "./CommFlow";

export const dynamic = "force-dynamic";

// Read-only view of the active pricing config for now. Editing (which inserts a
// new version and flips is_active) lands in a later phase — see build spec
// section 7 / 8.
const LABELS: Record<string, string> = {
  crew_size: "Crew size",
  labor_cost_per_person_hour: "Labor cost ($/person-hr)",
  equipment_cost_per_crew_hour: "Equipment cost ($/crew-hr)",
  turf_min_per_acre: "Turf (min/acre)",
  bed_min_per_1000sqft: "Bed (min/1000 sqft)",
  fixed_min_per_stop: "Fixed (min/stop)",
  drive_min_per_stop: "Drive (min/stop)",
  target_margin: "Target margin",
  margin_floor: "Margin floor",
  min_price_per_visit: "Min price/visit ($)",
  visits_per_year: "Visits/year",
  cole_profit_share: "Cole profit share",
  max_turf_acres: "Max turf acres",
  bed_turf_ratio_threshold: "Bed:turf review ratio",
  monthly_review_threshold: "Monthly review threshold ($)",
  market_floor_per_acre_visit: "Market floor ($/acre/visit)",
  market_ceiling_per_acre_visit: "Market ceiling ($/acre/visit)",
};

export default async function ConfigPage() {
  const co = await getDefaultCompany();
  const cfgRow = co ? await getActiveConfig(co.id) : null;

  if (!cfgRow) {
    return (
      <div className="max-w-5xl">
        <p className="text-sm text-gray-500">No active pricing config. Run `npm run db:seed`.</p>
        <CommFlow />
      </div>
    );
  }

  const cfg = toEngineConfig(cfgRow);
  const crewCost =
    cfg.crew_size * cfg.labor_cost_per_person_hour + cfg.equipment_cost_per_crew_hour;

  return (
    <div className="max-w-5xl">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold">Pricing config</h1>
        <p className="mt-1 text-sm text-gray-500">
          Active version {cfgRow.version}. Derived crew cost: ${crewCost.toFixed(2)}/hr. Editing
          (new version) comes in a later phase.
        </p>
        <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
          {Object.entries(LABELS).map(([key, label]) => (
            <div key={key} className="flex justify-between border-b border-gray-100 py-1">
              <dt className="text-gray-600">{label}</dt>
              <dd className="font-medium tabular-nums">{String((cfg as unknown as Record<string, number>)[key])}</dd>
            </div>
          ))}
        </dl>
      </div>
      <CommFlow />
    </div>
  );
}
