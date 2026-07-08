import type { ResidentialLead } from "../db/schema";
import { calculateLtv } from "./ltv";

export interface PackageTeaser {
  leadCount: number;
  signalCounts: Record<string, number>;
  strongestSignal: string;
  cities: string[];
  zips: string[];
  subdivisions: string[];
  ltvRange: { low: number; high: number };
  confidenceMix: Record<string, number>;
}

export function buildPackageTeaser(leads: ResidentialLead[]): PackageTeaser {
  const signalCounts: Record<string, number> = {};
  const confidenceMix: Record<string, number> = {};
  const cities = new Set<string>();
  const zips = new Set<string>();
  const subdivisions = new Set<string>();

  let strongestSignal = "";
  let maxSignalCount = 0;

  for (const lead of leads) {
    // Counts
    signalCounts[lead.signal_type] = (signalCounts[lead.signal_type] || 0) + 1;
    confidenceMix[lead.confidence] = (confidenceMix[lead.confidence] || 0) + 1;

    // Strongest signal determination
    if (signalCounts[lead.signal_type] > maxSignalCount) {
      maxSignalCount = signalCounts[lead.signal_type];
      strongestSignal = lead.signal_type;
    }

    // Location sets
    if (lead.city) cities.add(lead.city);
    if (lead.zip) zips.add(lead.zip);
    if (lead.subdivision_name) subdivisions.add(lead.subdivision_name);
  }

  // Calculate aggregate LTV
  const baseLtv = calculateLtv();
  // EXPECTED value, not fantasy: LTV x lead count implied a 100% win rate
  // (a 25-address package showed "$68k-$125k"). Apply the documented 2-5%
  // win rate per fresh address (lib/residential/economics.ts) so the teaser
  // shows what a buyer can actually expect to win from the package.
  const WIN_RATE_LOW = 0.02;
  const WIN_RATE_HIGH = 0.05;
  const ltvRange = {
    low: Math.round(baseLtv.low * leads.length * WIN_RATE_LOW),
    high: Math.round(baseLtv.high * leads.length * WIN_RATE_HIGH),
  };

  return {
    leadCount: leads.length,
    signalCounts,
    strongestSignal,
    cities: Array.from(cities),
    zips: Array.from(zips),
    subdivisions: Array.from(subdivisions),
    ltvRange,
    confidenceMix,
  };
}
