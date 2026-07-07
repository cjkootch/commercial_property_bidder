// Confidence gating for model-drafted measurements. Shared by the batch seeder
// (scripts/seed-predictions.ts) and the live auto-draft path so both apply the
// exact same rule. Pure — no I/O.

export type ModelConfidence = {
  /** Sigmoid margin inside the parcel: 0 = coin-flip, 1 = certain. */
  turf_margin: number;
  mean_margin: number;
  /** The model's vegetation fraction over the parcel. */
  veg_frac: number;
};

/**
 * Gate a model draft's measurement confidence. "Med" requires BOTH a decisive
 * model (high margin) AND agreement with the independent RGB vegetation
 * fraction — an uncalibrated margin alone can be confidently wrong. Anything
 * else stays "Low" (needs review). "High" is reserved for human labels.
 */
export function draftConfidence(
  conf: ModelConfidence | null | undefined,
  rgbVegFrac: number | null
): { level: "Med" | "Low"; why: string } {
  if (!conf) return { level: "Low", why: "no confidence data" };
  const margin = conf.turf_margin;
  if (rgbVegFrac == null) return { level: "Low", why: `margin ${margin.toFixed(2)}, no RGB cross-check` };
  const disagree = Math.abs(conf.veg_frac - rgbVegFrac);
  const why = `margin ${margin.toFixed(2)}, veg model ${(conf.veg_frac * 100).toFixed(0)}% vs RGB ${(rgbVegFrac * 100).toFixed(0)}%`;
  if (margin >= 0.75 && disagree <= 0.15) return { level: "Med", why };
  return { level: "Low", why };
}
