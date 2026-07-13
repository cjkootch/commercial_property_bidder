import { describe, expect, it } from "vitest";
import { shouldRevealCell, CELL_LOOKUP_MAX_AGE_DAYS } from "./cell";

const now = new Date(2026, 6, 13, 12, 0);
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe("sms/cell shouldRevealCell", () => {
  it("reveals for a non-mobile number never looked up", () => {
    expect(shouldRevealCell("landline", null, now)).toBe(true);
    expect(shouldRevealCell("tollFree", null, now)).toBe(true);
    expect(shouldRevealCell("unknown", null, now)).toBe(true);
    expect(shouldRevealCell(null, null, now)).toBe(true);
  });

  it("never spends when we already hold a confirmed mobile", () => {
    expect(shouldRevealCell("mobile", null, now)).toBe(false);
  });

  it("does not re-spend within the lookup window", () => {
    expect(shouldRevealCell("landline", daysAgo(1), now)).toBe(false);
    expect(shouldRevealCell("landline", daysAgo(CELL_LOOKUP_MAX_AGE_DAYS - 1), now)).toBe(false);
  });

  it("re-attempts once the window has passed", () => {
    expect(shouldRevealCell("landline", daysAgo(CELL_LOOKUP_MAX_AGE_DAYS + 1), now)).toBe(true);
  });
});
