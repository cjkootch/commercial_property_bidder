/**
 * Estimated LTV should be configurable/simple:
 * - base monthly lawn service value
 * - expected months retained
 * - optional add-on probability
 * - output low/high estimate
 */

export interface LtvEstimate {
  low: number;
  high: number;
}

export interface LtvConfig {
  baseMonthlyValue: number;
  expectedMonthsRetained: number;
  addonProbability: number;
  addonValue: number;
}

const DEFAULT_CONFIG: LtvConfig = {
  baseMonthlyValue: 150, // $150/mo
  expectedMonthsRetained: 24, // 2 years
  addonProbability: 0.3,
  addonValue: 500, // $500 one-time addon (mulch, trimming, etc)
};

export function calculateLtv(config: Partial<LtvConfig> = {}): LtvEstimate {
  const c = { ...DEFAULT_CONFIG, ...config };

  const baseLtv = c.baseMonthlyValue * c.expectedMonthsRetained;
  const addonExpectedValue = c.addonProbability * c.addonValue;

  // Low estimate: base value only, shorter retention (75%)
  const low = Math.round(baseLtv * 0.75);

  // High estimate: base value + addon, longer retention (125%)
  const high = Math.round(baseLtv * 1.25 + c.addonValue);

  return { low, high };
}
