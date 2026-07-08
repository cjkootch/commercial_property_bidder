import { describe, expect, it } from "vitest";
import { asTrade, DEFAULT_TRADE, TRADES, tradeNoun } from "./trades";
import { leadRank } from "./allocation";

const input = (over: Partial<Parameters<typeof TRADES.pest.rank>[0]>) => ({
  kind: "transfer" as const,
  annualHi: 20_000,
  monthsToCompletion: null,
  urgent: false,
  icpType: "retail_strip",
  notes: null,
  ...over,
});

describe("leads/trades — per-trade ranking", () => {
  it("landscaping keeps the original universal model exactly", () => {
    const i = input({ monthsToCompletion: 3, urgent: false });
    expect(TRADES.landscaping.rank(i)).toBe(leadRank(20_000, 3));
  });

  it("pest ranks a food-service opening above everything else on the shelf", () => {
    const restaurant = TRADES.pest.rank(
      input({ kind: "opening", notes: "TABC license application submitted 2026-07-01: ..." })
    );
    const genericOpening = TRADES.pest.rank(input({ kind: "opening", notes: "Sales-tax registration" }));
    const transfer = TRADES.pest.rank(input({ kind: "transfer" }));
    expect(restaurant).toBeGreaterThan(genericOpening);
    expect(restaurant).toBeGreaterThan(transfer);
  });

  it("pest values vector-risk citations above weeds-only citations", () => {
    const dumping = TRADES.pest.rank(
      input({ kind: "violation", notes: "311 case X (2026-07-01): cited for illegal dumping/debris", urgent: true })
    );
    const weeds = TRADES.pest.rank(
      input({ kind: "violation", notes: "311 case Y (2026-07-01): cited for weeds/overgrowth", urgent: true })
    );
    expect(dumping).toBeGreaterThan(weeds);
  });

  it("pest weights apartments (B1) above generic commercial on transfers", () => {
    const apartments = TRADES.pest.rank(input({ kind: "transfer", icpType: "residential" }));
    const generic = TRADES.pest.rank(input({ kind: "transfer", icpType: "retail_strip" }));
    expect(apartments).toBeGreaterThan(generic);
  });

  it("pest never ranks with landscaping's contract value — same lead, different order", () => {
    // Huge turf contract, cold signal vs small turf, hot pest signal.
    const bigTurfTransfer = input({ kind: "transfer", annualHi: 60_000 });
    const smallRestaurant = input({ kind: "opening", annualHi: 6_000, notes: "(TABC 1) NAICS 722511", urgent: false });
    expect(TRADES.landscaping.rank(bigTurfTransfer)).toBeGreaterThan(
      TRADES.landscaping.rank(smallRestaurant)
    );
    expect(TRADES.pest.rank(smallRestaurant)).toBeGreaterThan(TRADES.pest.rank(bigTurfTransfer));
  });

  it("public grounds bids are irrelevant to pest", () => {
    expect(TRADES.pest.relevant("rfp")).toBe(false);
    expect(TRADES.pest.rank(input({ kind: "rfp" }))).toBe(0);
    expect(TRADES.landscaping.relevant("rfp")).toBe(true);
  });

  it("verified no-turf drops a lead from the landscaping shelf only", () => {
    // Operator measured it: no grass -> not a landscaping lead.
    expect(TRADES.landscaping.sellable!({ turf_sqft: 0, verified: true })).toBe(false);
    expect(TRADES.landscaping.sellable!({ turf_sqft: 400, verified: true })).toBe(false);
    // A healthy verified lawn stays.
    expect(TRADES.landscaping.sellable!({ turf_sqft: 5_000, verified: true })).toBe(true);
    // Automated estimates are never trusted enough to pull a lead.
    expect(TRADES.landscaping.sellable!({ turf_sqft: 0, verified: false })).toBe(true);
    expect(TRADES.landscaping.sellable!(null)).toBe(true);
    // Pest doesn't mow — no turf floor at all.
    expect(TRADES.pest.sellable).toBeUndefined();
  });

  it("untrusted trade strings resolve safely", () => {
    expect(asTrade("pest")).toBe("pest");
    expect(asTrade("landscaping")).toBe("landscaping");
    expect(asTrade("__proto__")).toBe(DEFAULT_TRADE);
    expect(asTrade(null)).toBe(DEFAULT_TRADE);
    expect(tradeNoun("pest")).toBe("pest control companies");
    expect(tradeNoun(undefined)).toBe("landscaping companies");
  });
});
