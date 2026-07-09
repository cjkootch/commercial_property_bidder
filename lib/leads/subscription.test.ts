import { describe, expect, it } from "vitest";
import { FIRST_LOOK_HOURS, firstLookActive, hoursUntilPublic, inFirstLookWindow } from "./subscription";

const NOW = new Date("2026-07-09T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

describe("leads/subscription (First Look)", () => {
  it("membership requires the plan AND an unexpired window — lapses never comp", () => {
    expect(firstLookActive({ plan: "first_look", plan_expires_at: hoursAgo(-24 * 10) }, NOW)).toBe(true);
    expect(firstLookActive({ plan: "first_look", plan_expires_at: hoursAgo(1) }, NOW)).toBe(false);
    expect(firstLookActive({ plan: "first_look", plan_expires_at: null }, NOW)).toBe(false);
    expect(firstLookActive({ plan: "free", plan_expires_at: hoursAgo(-240) }, NOW)).toBe(false);
    expect(firstLookActive(null, NOW)).toBe(false);
  });

  it("the early-access window covers exactly the first day", () => {
    expect(inFirstLookWindow(hoursAgo(FIRST_LOOK_HOURS - 1), NOW)).toBe(true);
    expect(inFirstLookWindow(hoursAgo(FIRST_LOOK_HOURS + 1), NOW)).toBe(false);
    expect(hoursUntilPublic(hoursAgo(20), NOW)).toBe(4);
    expect(hoursUntilPublic(hoursAgo(23.9), NOW)).toBe(1);
  });
});
