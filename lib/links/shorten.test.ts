import { describe, expect, it } from "vitest";
import { claimTokenExpiry, findClaimUrls, generateCode } from "./shorten";

// The short code is a BEARER credential — whoever holds it reaches the claim
// page — so its unguessability is a security property, not a cosmetic one.
// findClaimUrls decides what gets rewritten inside an outgoing message, so its
// narrowness is what stops us mangling anything else in a text.

const CLAIM =
  "https://greenkeep.us/buyers/claim/eyJraW5kIjoiY2xhaW0iLCJwcm9wZXJ0eV9pZCI6ImUzZDU3ZjYyIiwiZXhwIjoxNzg4MDQzMzUwfQ.sig?trade=signage";

describe("generateCode", () => {
  it("is the requested length", () => {
    expect(generateCode()).toHaveLength(9);
    expect(generateCode(14)).toHaveLength(14);
  });

  it("avoids look-alike characters people mistype", () => {
    // 0/O and 1/l/I get read aloud over the phone and typed by hand.
    const sample = Array.from({ length: 200 }, () => generateCode()).join("");
    expect(sample).not.toMatch(/[0O1lI]/);
  });

  it("does not repeat across many draws", () => {
    // Not a proof of uniformity — a smoke test that it isn't returning a
    // constant or cycling a tiny space.
    const seen = new Set(Array.from({ length: 3000 }, () => generateCode()));
    expect(seen.size).toBe(3000);
  });

  it("uses a wide slice of the alphabet", () => {
    // Rejection sampling should reach most characters quickly; a modulo-folded
    // generator would still pass the collision test above but skew here.
    const chars = new Set(Array.from({ length: 500 }, () => generateCode()).join(""));
    expect(chars.size).toBeGreaterThan(45);
  });
});

describe("findClaimUrls", () => {
  it("finds a claim link in a message", () => {
    expect(findClaimUrls(`Open it: ${CLAIM}`)).toEqual([CLAIM]);
  });

  it("leaves every other URL alone", () => {
    // Only our own claim links may be rewritten. A sample-sheet link, a booking
    // link, or anything a human typed must survive untouched.
    const body = "See https://greenkeep.us/sample-sheet or book https://cal.com/nwhcg/walkthrough";
    expect(findClaimUrls(body)).toEqual([]);
  });

  it("dedupes a link repeated in one message", () => {
    expect(findClaimUrls(`${CLAIM} and again ${CLAIM}`)).toHaveLength(1);
  });

  it("returns nothing for a message with no links", () => {
    expect(findClaimUrls("Hey, would you like a free lead on a large commercial job?")).toEqual([]);
  });

  it("stops at whitespace, so trailing prose is not swallowed", () => {
    const [found] = findClaimUrls(`${CLAIM} — let me know`);
    expect(found).toBe(CLAIM);
    expect(found).not.toContain("let me know");
  });
});

describe("claimTokenExpiry", () => {
  it("reads the expiry out of the token payload", () => {
    // A short link must never outlive the token it wraps — landing someone on
    // "expired" is worse than sending them a long URL that works.
    const exp = claimTokenExpiry(CLAIM);
    expect(exp).toBeInstanceOf(Date);
    expect(exp?.getTime()).toBe(1788043350 * 1000);
  });

  it("returns null rather than throwing on an unreadable token", () => {
    expect(claimTokenExpiry("https://greenkeep.us/buyers/claim/not-a-token")).toBeNull();
    expect(claimTokenExpiry("https://greenkeep.us/commercial")).toBeNull();
    expect(claimTokenExpiry("")).toBeNull();
  });

  it("null expiry means the link simply never expires on our side", () => {
    // Deliberate: we do not invent an expiry we cannot read. The claim page
    // still validates the token itself.
    expect(claimTokenExpiry("https://greenkeep.us/buyers/claim/eyJhIjoxfQ.sig")).toBeNull();
  });
});
