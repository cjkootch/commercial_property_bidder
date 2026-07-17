import { describe, expect, it } from "vitest";
import { rowsForTrade, unlockWithinCap } from "./availability";

const at = (s: string) => new Date(s);
const row = (id: string, trade: string | null, created: string) => ({
  id,
  trade,
  created_at: at(created),
});

describe("rowsForTrade", () => {
  it("counts only my trade — a pest sale never burns a landscaping spot", () => {
    const rows = [
      { trade: "landscaping" },
      { trade: "pest" },
      { trade: "pest" },
    ];
    expect(rowsForTrade(rows, "landscaping")).toHaveLength(1);
    expect(rowsForTrade(rows, "pest")).toHaveLength(2);
  });

  it("NULL-trade history counts against EVERY trade (conservative, never oversold)", () => {
    const rows = [{ trade: null }, { trade: "pest" }];
    expect(rowsForTrade(rows, "landscaping")).toHaveLength(1);
    expect(rowsForTrade(rows, "pest")).toHaveLength(2);
  });
});

describe("unlockWithinCap (the concurrent-payment race guard)", () => {
  it("the first cap-many buyers keep their spots", () => {
    const rows = [
      row("a", "landscaping", "2026-07-17T10:00:00Z"),
      row("b", "landscaping", "2026-07-17T11:00:00Z"),
      row("c", "landscaping", "2026-07-17T12:00:00Z"),
    ];
    expect(unlockWithinCap(rows, "c", "landscaping", 3)).toBe(true);
  });

  it("the 4th same-trade buyer loses the race", () => {
    const rows = [
      row("a", "landscaping", "2026-07-17T10:00:00Z"),
      row("b", "landscaping", "2026-07-17T11:00:00Z"),
      row("c", "landscaping", "2026-07-17T12:00:00Z"),
      row("d", "landscaping", "2026-07-17T13:00:00Z"),
    ];
    expect(unlockWithinCap(rows, "d", "landscaping", 3)).toBe(false);
  });

  it("other trades' rows never crowd out mine", () => {
    const rows = [
      row("p1", "pest", "2026-07-17T09:00:00Z"),
      row("p2", "pest", "2026-07-17T09:30:00Z"),
      row("p3", "pest", "2026-07-17T09:45:00Z"),
      row("me", "landscaping", "2026-07-17T13:00:00Z"),
    ];
    expect(unlockWithinCap(rows, "me", "landscaping", 3)).toBe(true);
  });

  it("simultaneous timestamps break the tie deterministically by id — exactly one loser", () => {
    const rows = [
      row("a", "pest", "2026-07-17T10:00:00Z"),
      row("b", "pest", "2026-07-17T10:00:00Z"),
      row("x1", "pest", "2026-07-17T12:00:00Z"),
      row("x2", "pest", "2026-07-17T12:00:00Z"),
    ];
    // x1 < x2 lexically: with cap 3, x1 survives and x2 loses — on BOTH
    // concurrent webhook invocations, since the ranking is deterministic.
    expect(unlockWithinCap(rows, "x1", "pest", 3)).toBe(true);
    expect(unlockWithinCap(rows, "x2", "pest", 3)).toBe(false);
  });

  it("a row that was already deleted is never within cap", () => {
    expect(unlockWithinCap([], "ghost", "pest", 3)).toBe(false);
  });
});
