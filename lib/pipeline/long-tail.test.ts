import { describe, expect, it } from "vitest";
import {
  selectLongTailTargets,
  LONG_TAIL_EVERY_DAYS,
  LONG_TAIL_MAX_TOUCHES,
  type LongTailCandidate,
} from "./long-tail";

const now = new Date("2026-08-15T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

const base: LongTailCandidate = {
  key: "acme cleaning",
  name: "Acme Cleaning",
  email: "owner@acme.com",
  phone: "+17135550142",
  trade: "cleaning",
  blocked: false,
  converted: false,
  suppressed: false,
  optedOut: false,
  lastTouchAt: daysAgo(45),
  touches: 0,
};

describe("selectLongTailTargets", () => {
  it("selects a quiet prospect past the spacing window", () => {
    expect(selectLongTailTargets([base], { now, limit: 10 })).toHaveLength(1);
  });
  it("respects the 30-day spacing — a recent touch is not due", () => {
    const r = { ...base, lastTouchAt: daysAgo(LONG_TAIL_EVERY_DAYS - 1) };
    expect(selectLongTailTargets([r], { now, limit: 10 })).toHaveLength(0);
  });
  it("stops forever at the lifetime touch budget", () => {
    const r = { ...base, touches: LONG_TAIL_MAX_TOUCHES };
    expect(selectLongTailTargets([r], { now, limit: 10 })).toHaveLength(0);
  });
  it("never touches converted, blocked, or never-touched prospects", () => {
    expect(selectLongTailTargets([{ ...base, converted: true }], { now, limit: 10 })).toHaveLength(0);
    expect(selectLongTailTargets([{ ...base, blocked: true }], { now, limit: 10 })).toHaveLength(0);
    // Never-touched = the FIRST sequence's job, not the long tail's.
    expect(selectLongTailTargets([{ ...base, lastTouchAt: null }], { now, limit: 10 })).toHaveLength(0);
  });
  it("requires a reachable channel (suppressed email + opted-out phone = skip)", () => {
    const r = { ...base, suppressed: true, optedOut: true };
    expect(selectLongTailTargets([r], { now, limit: 10 })).toHaveLength(0);
    // Suppressed email but live phone still qualifies (SMS path).
    const smsOnly = { ...base, suppressed: true };
    expect(selectLongTailTargets([smsOnly], { now, limit: 10 })).toHaveLength(1);
  });
  it("serves the longest-waiting prospects first and honors the limit", () => {
    const older = { ...base, key: "b", lastTouchAt: daysAgo(90) };
    const newer = { ...base, key: "a", lastTouchAt: daysAgo(35) };
    const out = selectLongTailTargets([newer, older], { now, limit: 1 });
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe("b");
  });
});
