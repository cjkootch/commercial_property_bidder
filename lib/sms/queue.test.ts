import { describe, expect, it } from "vitest";
import { withinSmsSendWindow } from "./queue";

// Times below are UTC; Chicago is UTC-5 (CDT) in July, UTC-6 (CST) in January.
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
