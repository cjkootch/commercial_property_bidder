import { describe, expect, it } from "vitest";
import { ROTATION_SLOT_MS, rotateForSlot, TRADES, type Trade } from "./trades";

const HOUR = 3_600_000;
const trades = Object.keys(TRADES) as Trade[];

describe("rotateForSlot", () => {
  it("advances by one every slot, so consecutive runs lead with different trades", () => {
    // The regression that motivated extracting this: the slot was 2h while
    // demand ran hourly, so two consecutive invocations computed the SAME
    // offset. The front of the rotation got worked twice and the back never
    // came up at all.
    const a = rotateForSlot(trades, 0);
    const b = rotateForSlot(trades, HOUR);
    expect(a[0]).not.toBe(b[0]);
    expect(b[0]).toBe(a[1]);
  });

  it("is stable within a slot — a retry does not reshuffle the work", () => {
    expect(rotateForSlot(trades, 0)).toEqual(rotateForSlot(trades, HOUR - 1));
  });

  it("covers every trade before repeating", () => {
    const leaders = new Set(
      Array.from({ length: trades.length }, (_, i) => rotateForSlot(trades, i * HOUR)[0])
    );
    expect(leaders.size).toBe(trades.length);
  });

  it("keeps the full list, only reordered — no trade is ever dropped", () => {
    for (let i = 0; i < trades.length + 3; i++) {
      const out = rotateForSlot(trades, i * HOUR);
      expect(out).toHaveLength(trades.length);
      expect(new Set(out)).toEqual(new Set(trades));
    }
  });

  it("wraps instead of running off the end", () => {
    const far = rotateForSlot(trades, 10_000 * HOUR);
    expect(far).toHaveLength(trades.length);
    expect(new Set(far)).toEqual(new Set(trades));
  });

  it("survives an empty registry rather than dividing by zero", () => {
    expect(rotateForSlot([], 0)).toEqual([]);
  });

  it("the slot matches the hourly invocation cadence", () => {
    // If demand's schedule changes, this must change with it.
    expect(ROTATION_SLOT_MS).toBe(HOUR);
  });
});
