import { describe, expect, it } from "vitest";
import { dueForRenewal, RENEW_AFTER_DAYS, RENEW_COOLDOWN_DAYS } from "./renewals";
import { TRADES } from "../leads/trades";

const NOW = new Date("2027-06-15T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400_000);
const prop = (over: Partial<{ sale_cycle: number; renewed_at: Date | null; archived_at: Date | null }> = {}) => ({
  sale_cycle: 0,
  renewed_at: null,
  archived_at: null,
  ...over,
});
const sold = (daysAgoN: number, over: Partial<{ cycle: number; kind: string; trade: string }> = {}) => ({
  cycle: 0,
  kind: "paid",
  trade: "landscaping",
  created_at: daysAgo(daysAgoN),
  ...over,
});

describe("pipeline/renewals dueForRenewal", () => {
  it("reopens a lead ~11 months after its last current-cycle sale", () => {
    expect(dueForRenewal(prop(), [sold(RENEW_AFTER_DAYS + 5)], NOW)).toBe(true);
    // Too fresh — the buyer's first year isn't over.
    expect(dueForRenewal(prop(), [sold(RENEW_AFTER_DAYS - 30)], NOW)).toBe(false);
    // The LATEST sale gates it: an old sale + a recent one = not due.
    expect(dueForRenewal(prop(), [sold(400), sold(60)], NOW)).toBe(false);
  });

  it("never renews with nothing sold this cycle, archived, or recently renewed", () => {
    expect(dueForRenewal(prop(), [], NOW)).toBe(false);
    // Past-cycle sales alone don't trigger another renewal.
    expect(dueForRenewal(prop({ sale_cycle: 1 }), [sold(400, { cycle: 0 })], NOW)).toBe(false);
    expect(dueForRenewal(prop({ archived_at: daysAgo(10) }), [sold(400)], NOW)).toBe(false);
    expect(
      dueForRenewal(prop({ renewed_at: daysAgo(RENEW_COOLDOWN_DAYS - 10) }), [sold(400)], NOW)
    ).toBe(false);
    expect(
      dueForRenewal(prop({ sale_cycle: 1, renewed_at: daysAgo(RENEW_COOLDOWN_DAYS + 30) }), [sold(400, { cycle: 1 })], NOW)
    ).toBe(true);
  });

  it("an exclusive closes its trade forever, but other trades still renew", () => {
    // Landscaping exclusive: pest/cleaning/etc can still reopen.
    expect(dueForRenewal(prop(), [sold(400, { kind: "exclusive" })], NOW)).toBe(true);
    // Every registered trade closed by an exclusive -> nothing to reopen.
    // Derived from the registry so adding a trade keeps this test honest.
    const allExclusive = Object.keys(TRADES).map((t) => sold(400, { kind: "exclusive", trade: t }));
    expect(dueForRenewal(prop(), allExclusive, NOW)).toBe(false);
    // ...and one missing trade means the lead still renews for that trade.
    expect(dueForRenewal(prop(), allExclusive.slice(1), NOW)).toBe(true);
  });
});
