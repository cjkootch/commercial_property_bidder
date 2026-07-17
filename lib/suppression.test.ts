import { describe, expect, it } from "vitest";
import { rowsBlockTransactions } from "./suppression";

// The 2026-07-17 audit's two HIGH findings hinge on this split: a marketing
// opt-out must never block a purchase, while bounce/complaint rows must.
describe("rowsBlockTransactions", () => {
  it("a one-click unsubscribe alone does NOT block purchases", () => {
    expect(rowsBlockTransactions([{ reason: "one-click unsubscribe" }])).toBe(false);
  });

  it("no suppression rows → not blocked", () => {
    expect(rowsBlockTransactions([])).toBe(false);
  });

  it("a hard bounce blocks", () => {
    expect(rowsBlockTransactions([{ reason: "resend bounce" }])).toBe(true);
  });

  it("a spam complaint blocks", () => {
    expect(rowsBlockTransactions([{ reason: "resend complaint" }])).toBe(true);
  });

  it("unknown or missing reasons fail CLOSED (block)", () => {
    expect(rowsBlockTransactions([{ reason: null }])).toBe(true);
    expect(rowsBlockTransactions([{ reason: "manual" }])).toBe(true);
  });

  it("an opt-out alongside a bounce still blocks", () => {
    expect(
      rowsBlockTransactions([{ reason: "one-click unsubscribe" }, { reason: "resend bounce" }])
    ).toBe(true);
  });
});
