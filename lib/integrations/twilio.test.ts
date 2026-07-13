import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { isTextableLineType, smsStatusRank, toE164, verifyTwilioSignature } from "./twilio";

describe("smsStatusRank", () => {
  it("orders the delivery lifecycle monotonically", () => {
    expect(smsStatusRank("queued")).toBeLessThan(smsStatusRank("sent"));
    expect(smsStatusRank("sent")).toBeLessThan(smsStatusRank("delivered"));
    // Terminal states tie — a retried callback is an idempotent no-op.
    expect(smsStatusRank("failed")).toBe(smsStatusRank("delivered"));
    expect(smsStatusRank("undelivered")).toBe(smsStatusRank("delivered"));
    // The out-of-order case that motivated the guard:
    expect(smsStatusRank("sent")).toBeLessThan(smsStatusRank("delivered"));
    expect(smsStatusRank("unknown-future-status")).toBe(0);
  });
});

describe("toE164", () => {
  it("normalizes US formats", () => {
    expect(toE164("(713) 555-0142")).toBe("+17135550142");
    expect(toE164("713-555-0142")).toBe("+17135550142");
    expect(toE164("17135550142")).toBe("+17135550142");
    expect(toE164("+17135550142")).toBe("+17135550142");
  });
  it("rejects non-numbers", () => {
    expect(toE164("call the office")).toBeNull();
    expect(toE164("555-0142")).toBeNull();
    expect(toE164(null)).toBeNull();
  });
  it("rejects structurally-invalid NANP numbers (the launch-day garbage)", () => {
    expect(toE164("+16666666666")).toBeNull(); // all identical digits
    expect(toE164("0000000000")).toBeNull();
    expect(toE164("+11871868701")).toBeNull(); // area code starts with 1
    expect(toE164("1180000000")).toBeNull(); // area code 118 (starts 1)
    expect(toE164("2115550142")).toBeNull(); // N11 area code (211)
    expect(toE164("7132110142")).toBeNull(); // N11 exchange (211)
    expect(toE164("7131550142")).toBeNull(); // exchange starts with 1
  });
  it("still accepts genuine US numbers", () => {
    expect(toE164("713-555-0142")).toBe("+17135550142");
    expect(toE164("(832) 246-8100")).toBe("+18322468100");
  });
});

describe("isTextableLineType", () => {
  it("texts mobile and owner-cell VoIP (nonFixedVoip / generic voip)", () => {
    expect(isTextableLineType("mobile")).toBe(true);
    expect(isTextableLineType("voip")).toBe(true);
    expect(isTextableLineType("nonFixedVoip")).toBe(true);
  });
  it("skips landlines, toll-free, and fixedVoip (business phone systems)", () => {
    expect(isTextableLineType("landline")).toBe(false);
    expect(isTextableLineType("tollFree")).toBe(false);
    // 2026-07-13: every fixedVoip we texted bounced (carrier err 30006).
    expect(isTextableLineType("fixedVoip")).toBe(false);
  });
  it("fails open on unknown / unscreened numbers", () => {
    // A lookup outage or carrier-unmapped type must never silence the queue.
    expect(isTextableLineType("unknown")).toBe(true);
    expect(isTextableLineType(null)).toBe(true);
    expect(isTextableLineType(undefined)).toBe(true);
  });
});

describe("verifyTwilioSignature", () => {
  const url = "https://greenkeep.us/api/webhooks/twilio";
  const params = { From: "+17135550142", Body: "STOP", MessageSid: "SM123" };
  const sign = (token: string) =>
    crypto
      .createHmac("sha1", token)
      .update(
        url +
          Object.keys(params)
            .sort()
            .map((k) => k + params[k as keyof typeof params])
            .join("")
      )
      .digest("base64");

  it("accepts a signature built per the Twilio spec", () => {
    process.env.TWILIO_AUTH_TOKEN = "testtoken";
    expect(verifyTwilioSignature(url, params, sign("testtoken"))).toBe(true);
  });
  it("rejects a wrong token, missing signature, and tampered params", () => {
    process.env.TWILIO_AUTH_TOKEN = "testtoken";
    expect(verifyTwilioSignature(url, params, sign("other"))).toBe(false);
    expect(verifyTwilioSignature(url, params, null)).toBe(false);
    expect(
      verifyTwilioSignature(url, { ...params, Body: "START" }, sign("testtoken"))
    ).toBe(false);
  });
});
