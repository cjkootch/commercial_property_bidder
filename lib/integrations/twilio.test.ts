import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import {
  isTextableLineType,
  lookupLineType,
  smsStatusRank,
  toE164,
  verifyTwilioSignature,
} from "./twilio";

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
  it("fails open on UNSCREENED numbers (null), so a lookup outage can't silence the queue", () => {
    expect(isTextableLineType(null)).toBe(true);
    expect(isTextableLineType(undefined)).toBe(true);
    // A carrier value we don't recognize is also not a reason to block.
    expect(isTextableLineType("someNewCarrierType")).toBe(true);
  });
  it('SKIPS a number Twilio classified as "unknown"', () => {
    // Changed 2026-07-28. This test previously asserted true, on the reasoning
    // that unknown "fails open like an outage" — but the two cases are not the
    // same. NULL means we never asked (could be an outage): fail open. The
    // literal "unknown" means Twilio DID look and could not classify the
    // number, which is a negative signal. Texting those anyway ran 85.7%
    // undelivered across the 449 companies carrying the verdict.
    expect(isTextableLineType("unknown")).toBe(false);
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

describe("lookupLineType — outage vs verdict", () => {
  // The distinction exists because screen-lines went daily. A null return
  // leaves line_type_checked_at unstamped, so the row stays eligible forever;
  // that is correct for an outage and ruinous for a number Twilio will never
  // recognize, which would be re-bought every run at $0.008 a time.
  const withStubbedFetch = async (
    res: { status: number; body?: unknown },
    run: () => Promise<unknown>
  ) => {
    const prevFetch = globalThis.fetch;
    const prevEnv = {
      sid: process.env.TWILIO_ACCOUNT_SID,
      token: process.env.TWILIO_AUTH_TOKEN,
      from: process.env.TWILIO_FROM,
    };
    process.env.TWILIO_ACCOUNT_SID = "AC_test";
    process.env.TWILIO_AUTH_TOKEN = "<REDACTED>";
    process.env.TWILIO_FROM = "+17135550142";
    globalThis.fetch = (async () => ({
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.body ?? {},
    })) as unknown as typeof fetch;
    try {
      return await run();
    } finally {
      globalThis.fetch = prevFetch;
      process.env.TWILIO_ACCOUNT_SID = prevEnv.sid;
      process.env.TWILIO_AUTH_TOKEN = prevEnv.token;
      process.env.TWILIO_FROM = prevEnv.from;
    }
  };
  const num = "+17135550142";

  it("treats a 404 as an answer, so the row gets stamped and stops retrying", async () => {
    const out = await withStubbedFetch({ status: 404 }, () => lookupLineType(num));
    expect(out).toBe("unknown");
  });

  it("treats 429 and 5xx as outages, so the row is retried", async () => {
    expect(await withStubbedFetch({ status: 429 }, () => lookupLineType(num))).toBeNull();
    expect(await withStubbedFetch({ status: 500 }, () => lookupLineType(num))).toBeNull();
  });

  it("passes through a real classification", async () => {
    const out = await withStubbedFetch(
      { status: 200, body: { line_type_intelligence: { type: "mobile" } } },
      () => lookupLineType(num)
    );
    expect(out).toBe("mobile");
  });

  it("records 'unknown' when Lookup answers but cannot classify", async () => {
    const out = await withStubbedFetch(
      { status: 200, body: { line_type_intelligence: { type: null } } },
      () => lookupLineType(num)
    );
    // And "unknown" is disqualifying — the two halves must agree, or numbers
    // get texted on the strength of a non-answer.
    expect(out).toBe("unknown");
    expect(isTextableLineType("unknown")).toBe(false);
  });
});
