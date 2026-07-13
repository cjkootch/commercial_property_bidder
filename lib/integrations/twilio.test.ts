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
});

describe("isTextableLineType", () => {
  it("texts mobile and voip", () => {
    expect(isTextableLineType("mobile")).toBe(true);
    expect(isTextableLineType("voip")).toBe(true);
  });
  it("skips true landlines", () => {
    expect(isTextableLineType("landline")).toBe(false);
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
