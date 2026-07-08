import { describe, expect, it } from "vitest";
import {
  freshnessDecay,
  MIN_PACKAGE_LEADS,
  PACKAGE_MAX_CENTS,
  PACKAGE_MIN_CENTS,
  pricePackage,
  subscriptionViable,
  SUBSCRIPTION_MIN_LEADS_PER_MONTH,
} from "./economics";

const lead = (ageDays: number, signalType: any = "recently_sold", confidence: any = "High") => ({
  signalType,
  confidence,
  ageDays,
});
const bundle = (n: number, ageDays = 7) => Array.from({ length: n }, () => lead(ageDays));

describe("residential/economics", () => {
  it("freshness decays hard — a two-week mover is worth ~7x a stale one", () => {
    expect(freshnessDecay(7)).toBe(1.0);
    expect(freshnessDecay(30)).toBe(0.7);
    expect(freshnessDecay(60)).toBe(0.4);
    expect(freshnessDecay(120)).toBe(0.15);
  });

  it("under MIN_PACKAGE_LEADS is not a product (the R0 one-lead-report lesson)", () => {
    const p = pricePackage(bundle(3));
    expect(p.sellable).toBe(false);
    expect(pricePackage(bundle(MIN_PACKAGE_LEADS)).sellable).toBe(true);
  });

  it("price tracks volume, quality, AND freshness through one lever", () => {
    const fresh25 = pricePackage(bundle(25, 7));
    const fresh15 = pricePackage(bundle(15, 7));
    const stale25 = pricePackage(bundle(25, 120));
    expect(fresh25.price_cents).toBeGreaterThan(fresh15.price_cents); // more addresses
    expect(fresh25.price_cents).toBeGreaterThan(stale25.price_cents); // fresher
    // a fresh recently-sold address prices ~$2 (80 pts x $0.025)
    expect(fresh25.per_address_cents).toBeGreaterThanOrEqual(180);
    expect(fresh25.per_address_cents).toBeLessThanOrEqual(220);
  });

  it("floors and caps keep prices sane at the extremes", () => {
    expect(pricePackage(bundle(15, 400)).price_cents).toBe(PACKAGE_MIN_CENTS);
    expect(pricePackage(bundle(500, 1)).price_cents).toBe(PACKAGE_MAX_CENTS);
  });

  it("subscription beats cherry-picking; exclusive costs a real premium", () => {
    const p = pricePackage(bundle(30, 7));
    expect(p.subscription_cents_per_month).toBeLessThan(p.price_cents);
    expect(p.exclusive_cents).toBeGreaterThan(p.price_cents * 2);
  });

  it("subscriptions only sell where the flow is provably constant", () => {
    expect(subscriptionViable([20, 18, 25])).toBe(true);
    expect(subscriptionViable([30])).toBe(false); // no history, no promise
    expect(subscriptionViable([30, 2])).toBe(false); // worst month too thin
    expect(subscriptionViable([SUBSCRIPTION_MIN_LEADS_PER_MONTH - 5, 8])).toBe(false);
  });
});
