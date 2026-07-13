import { describe, expect, it } from "vitest";
import { selectBouncedPhones } from "./recover";

const send = (phone: string, status: string, min: number, direction = "out") => ({
  direction,
  phone,
  status,
  created_at: new Date(2026, 6, 13, 9, min),
});

describe("sms/recover selectBouncedPhones", () => {
  it("flags a phone whose latest outbound send terminally failed", () => {
    const b = selectBouncedPhones([send("+1811", "failed", 0)]);
    expect(b.has("+1811")).toBe(true);
    expect(selectBouncedPhones([send("+1822", "undelivered", 0)]).has("+1822")).toBe(true);
  });

  it("does NOT flag a phone that later delivered (latest wins)", () => {
    // opener failed, manual retry got through — not a dead number.
    const b = selectBouncedPhones([send("+1811", "failed", 0), send("+1811", "delivered", 5)]);
    expect(b.has("+1811")).toBe(false);
  });

  it("still flags when a later send re-failed", () => {
    const b = selectBouncedPhones([send("+1811", "delivered", 0), send("+1811", "failed", 5)]);
    expect(b.has("+1811")).toBe(true);
  });

  it("ignores inbound and non-terminal statuses", () => {
    expect(selectBouncedPhones([send("+1833", "received", 0, "in")]).size).toBe(0);
    expect(selectBouncedPhones([send("+1844", "delivered", 0)]).size).toBe(0);
    expect(selectBouncedPhones([send("+1855", "queued", 0)]).size).toBe(0);
  });
});
