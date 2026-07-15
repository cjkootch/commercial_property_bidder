import { describe, expect, it } from "vitest";
import {
  HOLD_REMIND_BEFORE_HOURS,
  buildHoldReminderEmail,
  holdReminderSmsFor,
  localClock,
  selectExpiringHolds,
} from "./hold-expiry";

const NOW = new Date("2026-07-16T14:00:00Z");
const hold = (id: string, minsFromNow: number) => ({
  id,
  expires_at: new Date(NOW.getTime() + minsFromNow * 60_000),
});

describe("selectExpiringHolds", () => {
  it("picks holds inside the lookahead that were never reminded", () => {
    const due = selectExpiringHolds(
      [hold("a", 120), hold("b", 240)],
      new Set<string | null>(),
      NOW
    );
    expect(due.map((h) => h.id)).toEqual(["a", "b"]);
  });

  it("skips already-reminded, about-to-lapse, and too-far-out holds", () => {
    const due = selectExpiringHolds(
      [
        hold("reminded", 120),
        hold("lapsing", 10), // under the min-runway floor
        hold("far", (HOLD_REMIND_BEFORE_HOURS + 2) * 60), // outside lookahead
        hold("expired", -5),
        hold("ok", 90),
      ],
      new Set<string | null>(["reminded"]),
      NOW
    );
    expect(due.map((h) => h.id)).toEqual(["ok"]);
  });
});

describe("localClock", () => {
  it("renders the deadline on the recipient's clock", () => {
    // 18:11 UTC in July = 1:11 PM Central (CDT).
    expect(localClock(new Date("2026-07-16T18:11:00Z"), "America/Chicago")).toBe("1:11 PM");
  });
});

describe("holdReminderSmsFor", () => {
  it("names the job, the local deadline, and carries the claim link", () => {
    const t = holdReminderSmsFor({
      city: "Houston",
      trade: "cleaning",
      expiresAt: new Date("2026-07-16T18:11:00Z"),
      tz: "America/Chicago",
      claimUrl: "https://greenkeep.us/buyers/claim/tok?trade=cleaning",
    });
    expect(t).toContain("Houston cleaning job");
    expect(t).toContain("1:11 PM");
    expect(t).toContain("https://greenkeep.us/buyers/claim/tok?trade=cleaning");
    expect(t).toContain("-Cole");
  });

  it("drops an unknown city cleanly", () => {
    const t = holdReminderSmsFor({
      city: null,
      trade: "landscaping",
      expiresAt: new Date("2026-07-16T18:11:00Z"),
      tz: "America/Chicago",
      claimUrl: "https://x.example/c",
    });
    expect(t).not.toContain("null");
  });
});

describe("buildHoldReminderEmail", () => {
  it("puts the deadline in the subject and the link in the body", () => {
    const m = buildHoldReminderEmail({
      company: "Acme Cleaning",
      city: "Houston",
      trade: "cleaning",
      expiresAt: new Date("2026-07-16T18:11:00Z"),
      tz: "America/Chicago",
      claimUrl: "https://greenkeep.us/buyers/claim/tok?trade=cleaning",
      brand: "Greenkeep",
    });
    expect(m.subject).toContain("1:11 PM");
    expect(m.body).toContain("https://greenkeep.us/buyers/claim/tok?trade=cleaning");
    expect(m.body).toContain("next company in line");
  });
});
