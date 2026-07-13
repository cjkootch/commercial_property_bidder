import { describe, expect, it } from "vitest";
import { ensureClaimLink } from "./claude";

const URL = "https://greenkeep.us/buyers/claim/abc123?trade=cleaning";

describe("ensureClaimLink", () => {
  it("appends the link when a pitch drops it (the 2026-07-13 incident)", () => {
    const draft =
      "Cole with Greenkeep. We found a new business opening in San Antonio that needs cleaning — ~6,847 sq ft, est $6,600–$12,300/yr recurring. First one's free to claim.";
    const out = ensureClaimLink(draft, URL, [
      { direction: "out", body: "Hi, is this Maids on a Mission?" },
      { direction: "in", body: "Yes, how can we help?" },
    ]);
    expect(out).toContain(URL);
    expect(out.startsWith(draft)).toBe(true);
  });

  it("leaves the draft alone when it already contains the link", () => {
    const draft = `Here it is, no charge: ${URL} — let me know if it's useful.`;
    expect(ensureClaimLink(draft, URL, [])).toBe(draft);
  });

  it("does not re-send a link already delivered earlier in the thread", () => {
    const draft = "Yeah, these come from public permit filings — all verified.";
    const thread = [
      { direction: "out", body: `Your opportunity: ${URL}` },
      { direction: "in", body: "Are these verified?" },
    ];
    expect(ensureClaimLink(draft, URL, thread)).toBe(draft);
  });

  it("never attaches a link to a human hand-off", () => {
    const draft = "Cole will call you this afternoon.";
    expect(ensureClaimLink(draft, URL, [])).toBe(draft);
  });

  it("never attaches a link to a polite close", () => {
    const draft = "No problem — you won't hear from us again. All the best.";
    expect(ensureClaimLink(draft, URL, [])).toBe(draft);
  });

  it("is a no-op when there is no link to deliver", () => {
    const draft = "Cole with Greenkeep — mind if I send over a local lead?";
    expect(ensureClaimLink(draft, null, [])).toBe(draft);
  });
});
