import { describe, expect, it } from "vitest";
import { heldByOther, heldForMe, holdExpiry, HOLD_TTL_HOURS } from "./holds";

const now = new Date("2026-07-13T12:00:00Z");
const live = { company: "acme signs", expires_at: new Date("2026-07-13T18:00:00Z") };
const expired = { company: "acme signs", expires_at: new Date("2026-07-13T06:00:00Z") };

describe("holdExpiry", () => {
  it("is HOLD_TTL_HOURS ahead of now", () => {
    expect(holdExpiry(now).getTime()).toBe(now.getTime() + HOLD_TTL_HOURS * 3_600_000);
    expect(HOLD_TTL_HOURS).toBe(24);
  });
});

describe("heldByOther", () => {
  it("blocks a different company while the hold is live", () => {
    expect(heldByOther(live, "other co", now)).toBe(true);
  });
  it("does not block the company the spot is held for", () => {
    expect(heldByOther(live, "acme signs", now)).toBe(false);
  });
  it("does not block once the hold has expired (released)", () => {
    expect(heldByOther(expired, "other co", now)).toBe(false);
  });
  it("does not block when there is no hold", () => {
    expect(heldByOther(null, "other co", now)).toBe(false);
  });
});

describe("heldForMe", () => {
  it("is true only for the holder while live", () => {
    expect(heldForMe(live, "acme signs", now)).toBe(true);
    expect(heldForMe(live, "other co", now)).toBe(false);
  });
  it("is false when expired or keyless", () => {
    expect(heldForMe(expired, "acme signs", now)).toBe(false);
    expect(heldForMe(live, null, now)).toBe(false);
    expect(heldForMe(null, "acme signs", now)).toBe(false);
  });
});
