import { describe, expect, it } from "vitest";
import { addDays, daysUntil, isDue, isValidDateStr, revisitDigestText, todayInTz } from "./revisit";
import type { DueRevisit } from "./revisit";

// The revisit predicate is the one piece of logic in the system that must be
// right, so it is pure and tested directly. Everything else about the feature
// (queries, emails, cron) can fail loudly; a wrong DUE answer fails silently.

describe("isDue", () => {
  it("is due on the day itself (inclusive)", () => {
    expect(isDue("2027-03-01", "2027-03-01")).toBe(true);
  });

  it("is due when overdue", () => {
    expect(isDue("2026-01-15", "2027-03-01")).toBe(true);
  });

  it("is not due in the future", () => {
    expect(isDue("2027-03-02", "2027-03-01")).toBe(false);
  });

  it("an unscheduled record is never due", () => {
    expect(isDue(null, "2099-01-01")).toBe(false);
  });

  it("compares correctly across year and month boundaries (string compare is safe for ISO dates)", () => {
    expect(isDue("2026-12-31", "2027-01-01")).toBe(true);
    expect(isDue("2027-01-01", "2026-12-31")).toBe(false);
    // The classic lexicographic trap — zero-padded ISO has no such trap.
    expect(isDue("2027-09-09", "2027-10-01")).toBe(true);
  });
});

describe("daysUntil", () => {
  it("counts forward and backward", () => {
    expect(daysUntil("2027-03-08", "2027-03-01")).toBe(7);
    expect(daysUntil("2027-03-01", "2027-03-01")).toBe(0);
    expect(daysUntil("2027-02-22", "2027-03-01")).toBe(-7);
  });

  it("is DST-proof (a spring-forward week is still 7 days)", () => {
    // US DST 2027 begins Mar 14. A naive local-midnight diff yields 6.958 days
    // here and rounds wrong in some implementations; UTC parsing avoids it.
    expect(daysUntil("2027-03-17", "2027-03-10")).toBe(7);
  });

  it("spans leap day correctly", () => {
    expect(daysUntil("2028-03-01", "2028-02-28")).toBe(2); // 2028 is a leap year
  });

  it("survives a multi-year fuse", () => {
    expect(daysUntil("2029-07-24", "2026-07-24")).toBe(1096); // 3y incl. one leap day
  });
});

describe("addDays", () => {
  it("adds across month and year ends", () => {
    expect(addDays("2027-01-31", 1)).toBe("2027-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("handles the snooze presets used by the queue UI", () => {
    expect(addDays("2026-07-24", 7)).toBe("2026-07-31");
    expect(addDays("2026-07-24", 30)).toBe("2026-08-23");
    expect(addDays("2026-07-24", 365)).toBe("2027-07-24");
  });

  it("adds into a leap day without drifting", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("rejects a malformed date rather than silently returning garbage", () => {
    expect(() => addDays("not-a-date", 7)).toThrow();
  });
});

describe("isValidDateStr", () => {
  it("accepts a real ISO date", () => {
    expect(isValidDateStr("2027-03-01")).toBe(true);
    expect(isValidDateStr("2028-02-29")).toBe(true); // leap year
  });

  it("rejects shapes Postgres would choke on mid-statement", () => {
    expect(isValidDateStr("2027-3-1")).toBe(false);
    expect(isValidDateStr("03/01/2027")).toBe(false);
    expect(isValidDateStr("2027-03-01T00:00:00Z")).toBe(false);
    expect(isValidDateStr("")).toBe(false);
  });

  it("rejects a date that looks valid but doesn't exist", () => {
    expect(isValidDateStr("2027-02-30")).toBe(false);
    expect(isValidDateStr("2027-13-01")).toBe(false);
  });
});

describe("todayInTz", () => {
  it("returns the LOCAL working day, not the UTC day", () => {
    // 2026-07-25T01:30Z is still Jul 24 in New York — a revisit set for the 25th
    // must NOT surface yet for an ET firm.
    const at = new Date("2026-07-25T01:30:00Z");
    expect(todayInTz("America/New_York", at)).toBe("2026-07-24");
    expect(todayInTz("UTC", at)).toBe("2026-07-25");
  });

  it("formats as YYYY-MM-DD, matching the DATE column's text form", () => {
    expect(todayInTz("UTC", new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
  });
});

describe("revisitDigestText", () => {
  const item = (over: Partial<DueRevisit> = {}): DueRevisit => ({
    entity: "company",
    id: "11111111-1111-1111-1111-111111111111",
    companyId: "22222222-2222-2222-2222-222222222222",
    companyName: "Ridgeline Fabrication",
    label: null,
    revisitDate: "2026-07-20",
    note: "Said revisit after the 2027 capex cycle",
    userId: null,
    userEmail: null,
    surfacedAt: null,
    daysUntil: -4,
    ...over,
  });

  it("leads with the count and includes the note verbatim", () => {
    const text = revisitDigestText([item()], "https://crm.example");
    expect(text).toContain("1 revisit due");
    expect(text).toContain("Ridgeline Fabrication");
    // The REASON is what makes a digest actionable rather than ignorable.
    expect(text).toContain("Said revisit after the 2027 capex cycle");
    expect(text).toContain("https://crm.example/companies/22222222-2222-2222-2222-222222222222");
  });

  it("flags overdue days and pluralizes", () => {
    const text = revisitDigestText([item(), item({ id: "b", daysUntil: -30 })], "https://x");
    expect(text).toContain("2 revisits due");
    expect(text).toContain("(4d overdue)");
    expect(text).toContain("(30d overdue)");
  });

  it("shows a contact/deal label when the revisit is not company-level", () => {
    const text = revisitDigestText([item({ entity: "contact", label: "Dana Ruiz" })], "https://x");
    expect(text).toContain("Ridgeline Fabrication — Dana Ruiz");
  });

  it("omits the overdue marker for something due today", () => {
    const text = revisitDigestText([item({ daysUntil: 0 })], "https://x");
    expect(text).not.toContain("overdue");
  });
});
