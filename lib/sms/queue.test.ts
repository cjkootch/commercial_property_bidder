import { describe, expect, it } from "vitest";
import {
  nudgeTextFor,
  OPT_OUT_LINE,
  selectSmsNudges,
  SMS_NUDGE_AFTER_HOURS,
  SMS_NUDGE_MAX_AGE_DAYS,
  withinSmsSendWindow,
  withinTcpaHours,
} from "./queue";

// Times below are UTC; Chicago is UTC-5 (CDT) in July, UTC-6 (CST) in January.
describe("withinTcpaHours (auto-reply quiet-hours gate, 8am–9pm local)", () => {
  it("allows an evening reply the cold-outreach window would block", () => {
    expect(withinTcpaHours(new Date("2026-07-13T23:30:00Z"))).toBe(true); // Mon 6:30pm CDT
    expect(withinTcpaHours(new Date("2026-07-14T01:59:00Z"))).toBe(true); // Mon 8:59pm CDT
  });
  it("blocks quiet hours — the 11pm auto-reply", () => {
    expect(withinTcpaHours(new Date("2026-07-14T04:00:00Z"))).toBe(false); // Mon 11pm CDT
    expect(withinTcpaHours(new Date("2026-07-14T12:30:00Z"))).toBe(false); // Tue 7:30am CDT
  });
  it("allows weekends (TCPA hours are not business-day-scoped)", () => {
    expect(withinTcpaHours(new Date("2026-07-18T18:00:00Z"))).toBe(true); // Sat 1pm CDT
  });
});

describe("withinSmsSendWindow", () => {
  it("allows weekday business hours in Texas", () => {
    expect(withinSmsSendWindow(new Date("2026-07-13T15:37:00Z"))).toBe(true); // Mon 10:37 CDT
    expect(withinSmsSendWindow(new Date("2026-07-17T19:07:00Z"))).toBe(true); // Fri 2:07pm CDT
    expect(withinSmsSendWindow(new Date("2026-01-14T16:00:00Z"))).toBe(true); // Wed 10am CST (DST shift)
  });
  it("blocks nights and weekends", () => {
    expect(withinSmsSendWindow(new Date("2026-07-14T05:00:00Z"))).toBe(false); // Tue 12am CDT
    expect(withinSmsSendWindow(new Date("2026-07-14T13:30:00Z"))).toBe(false); // Tue 8:30am CDT (pre-9)
    expect(withinSmsSendWindow(new Date("2026-07-13T23:30:00Z"))).toBe(false); // Mon 6:30pm CDT (post-18)
    expect(withinSmsSendWindow(new Date("2026-07-18T16:00:00Z"))).toBe(false); // Sat 11am CDT
    expect(withinSmsSendWindow(new Date("2026-07-19T16:00:00Z"))).toBe(false); // Sun 11am CDT
  });
});

describe("selectSmsNudges (the no-reply follow-up)", () => {
  const NOW = new Date("2026-07-12T12:00:00Z");
  const H = 3600_000;
  const D = 24 * H;
  const at = (msAgo: number) => new Date(NOW.getTime() - msAgo);
  const opener = (phone: string, msAgo: number) => ({
    direction: "out",
    kind: "text_queue",
    phone,
    created_at: at(msAgo),
  });
  const pick = (sends: Parameters<typeof selectSmsNudges>[0]["sends"], optedOut: string[] = []) =>
    selectSmsNudges({ now: NOW, sends, optedOut: new Set(optedOut) });

  it("selects a silent opener past the window", () => {
    expect(pick([opener("+15550001111", 3 * D)]).has("+15550001111")).toBe(true);
  });
  it("skips openers younger than the window", () => {
    expect(pick([opener("+15550001111", (SMS_NUDGE_AFTER_HOURS - 1) * H)]).size).toBe(0);
  });
  it("skips openers whose claim token is near death", () => {
    expect(pick([opener("+15550001111", (SMS_NUDGE_MAX_AGE_DAYS + 1) * D)]).size).toBe(0);
  });
  it("skips anyone who replied — the conversation path owns them", () => {
    const sends = [
      opener("+15550001111", 3 * D),
      { direction: "in", kind: "inbound", phone: "+15550001111", created_at: at(2 * D) },
    ];
    expect(pick(sends).size).toBe(0);
  });
  it("never nudges twice", () => {
    const sends = [
      opener("+15550001111", 5 * D),
      { direction: "out", kind: "text_nudge", phone: "+15550001111", created_at: at(2 * D) },
    ];
    expect(pick(sends).size).toBe(0);
  });
  it("skips opted-out numbers", () => {
    expect(pick([opener("+15550001111", 3 * D)], ["+15550001111"]).size).toBe(0);
  });
  it("skips a phone a human (or the AI) already texted after the opener", () => {
    const sends = [
      opener("+15550001111", 3 * D),
      { direction: "out", kind: "inbox_sms", phone: "+15550001111", created_at: at(1 * D) },
    ];
    expect(pick(sends).size).toBe(0);
  });
  it("skips openers the carrier rejected — the nudge would fail the same way", () => {
    expect(pick([{ ...opener("+15550001111", 3 * D), status: "undelivered" }]).size).toBe(0);
    expect(pick([{ ...opener("+15550001111", 3 * D), status: "failed" }]).size).toBe(0);
  });
  it("nudges when any opener log for the phone was deliverable", () => {
    const sends = [
      { ...opener("+15550001111", 3 * D), status: "failed" },
      { ...opener("+15550001111", 3 * D - H), status: "delivered" },
    ];
    expect(pick(sends).has("+15550001111")).toBe(true);
  });
  it("measures from the FIRST opener when retries logged more than one", () => {
    const due = pick([opener("+15550001111", 3 * D), opener("+15550001111", 1 * H)]);
    expect(due.get("+15550001111")?.getTime()).toBe(NOW.getTime() - 3 * D);
  });
});

describe("nudgeTextFor", () => {
  it("delivers the link, identifies the business, and offers the opt-out", () => {
    const text = nudgeTextFor("Acme Lawn", "https://greenkeep.us/buyers/claim/tok");
    expect(text).toContain("https://greenkeep.us/buyers/claim/tok");
    expect(text).toContain("Greenkeep");
    expect(text).toContain(OPT_OUT_LINE);
  });
  it("names the REAL dollar size and the 24h first-claim hold when sized", () => {
    const text = nudgeTextFor("Acme Lawn", "https://x/claim/tok", {
      city: "HOUSTON",
      service: "cleaning",
      estLo: 6600,
      estHi: 12300,
    });
    expect(text).toContain("a Houston cleaning job, est. $6,600-$12,300/yr");
    expect(text).toContain("first claim for 24h");
    expect(text).toContain("Each lead goes to one company");
  });
  it("degrades gracefully without an estimate or city", () => {
    const text = nudgeTextFor("Acme Lawn", "https://x/claim/tok", { service: "roofing" });
    expect(text).toContain("a roofing job. Each lead goes to one company");
    expect(text).not.toContain("est.");
    expect(text).not.toContain("$");
  });
});
