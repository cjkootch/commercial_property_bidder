import { describe, expect, it } from "vitest";
import { isPermanentFailure, PERMANENT_SMS_ERROR_CODES } from "./undeliverable";
import { isTextableLineType } from "../integrations/twilio";
import { pickOutcomeChannel } from "../pipeline/outcome-check";

// This decides whether a phone number is ever contacted again. Condemning a
// good number silently deletes a prospect; failing to condemn a dead one is the
// retry loop that put outbound SMS at 27% undelivered. Both directions tested.

describe("isPermanentFailure", () => {
  it("condemns the two codes that never become deliverable", () => {
    expect(isPermanentFailure("30005")).toBe(true); // number does not exist
    expect(isPermanentFailure("30006")).toBe(true); // landline / can't receive SMS
  });

  it("does NOT condemn a transient failure", () => {
    // 30003 is handset off or out of range — it rings fine tomorrow.
    expect(isPermanentFailure("30003")).toBe(false);
  });

  it("does NOT condemn on an unknown error", () => {
    // 30008 carries no verdict. Suppressing on it would delete prospects over
    // a carrier hiccup.
    expect(isPermanentFailure("30008")).toBe(false);
  });

  it("does NOT condemn on OUR configuration failure", () => {
    // 30034 = A2P campaign not registered. The number is fine; we are broken.
    // Suppressing here would quietly erase the audience while hiding the real
    // fix, and the damage would be invisible until someone counted.
    expect(isPermanentFailure("30034")).toBe(false);
  });

  it("treats a delivered message (no code) as no verdict", () => {
    expect(isPermanentFailure(null)).toBe(false);
    expect(isPermanentFailure(undefined)).toBe(false);
    expect(isPermanentFailure("")).toBe(false);
  });

  it("tolerates the code arriving as a padded string from form data", () => {
    // Twilio posts these as form fields; whitespace must not defeat the check.
    expect(isPermanentFailure(" 30005 ")).toBe(true);
  });

  it("keeps the permanent set deliberately small", () => {
    // A guard against future casual additions: widening this set silently
    // shrinks the reachable audience, so it should take a code change plus
    // this test failing to do it.
    expect([...PERMANENT_SMS_ERROR_CODES].sort()).toEqual(["30005", "30006"]);
  });
});

describe("isTextableLineType", () => {
  it("texts real cells, including VoIP cells", () => {
    expect(isTextableLineType("mobile")).toBe(true);
    // Google Voice / TextNow — an owner's actual number. 11% failure, the best
    // performing category after mobile.
    expect(isTextableLineType("nonFixedVoip")).toBe(true);
  });

  it("skips line types that cannot receive A2P SMS", () => {
    expect(isTextableLineType("landline")).toBe(false);
    expect(isTextableLineType("tollFree")).toBe(false);
    expect(isTextableLineType("fixedVoip")).toBe(false);
  });

  it('skips a number Twilio classified as "unknown"', () => {
    // 85.7% undelivered across the 449 companies carrying this verdict.
    expect(isTextableLineType("unknown")).toBe(false);
  });

  it("still texts a NEVER-SCREENED number (null), failing open", () => {
    // The distinction that matters: null means we never asked, which can be a
    // Lookup outage. A screen must never silence the whole queue.
    expect(isTextableLineType(null)).toBe(true);
    expect(isTextableLineType(undefined)).toBe(true);
  });

  it("passes through an unrecognized carrier value rather than blocking it", () => {
    expect(isTextableLineType("somethingNew")).toBe(true);
  });
});

describe("pickOutcomeChannel", () => {
  const base = { phone: "+15125550100", lineType: "mobile", email: "a@b.com", emailOk: true };

  it("prefers SMS for a reachable mobile", () => {
    expect(pickOutcomeChannel(base)).toBe("sms");
  });

  it("falls back to EMAIL when the carrier already rejected the number", () => {
    // The hold_expiry bug: 13 messages to 3 dead numbers while a working email
    // address sat unused on the same record.
    expect(pickOutcomeChannel({ ...base, smsOk: false })).toBe("email");
  });

  it("returns null when the number is dead and there is no email", () => {
    expect(pickOutcomeChannel({ ...base, smsOk: false, email: null })).toBeNull();
  });

  it("defaults to SMS-allowed when smsOk is omitted, so old callers are unchanged", () => {
    const { ...noFlag } = base;
    expect(pickOutcomeChannel(noFlag)).toBe("sms");
  });

  it("still skips a landline even when smsOk is true", () => {
    // The two guards are independent: one is what the carrier told us after a
    // send, the other is what Lookup told us before one.
    expect(pickOutcomeChannel({ ...base, lineType: "landline", smsOk: true })).toBe("email");
  });

  it("respects a suppressed email address", () => {
    expect(pickOutcomeChannel({ ...base, smsOk: false, emailOk: false })).toBeNull();
  });
});
