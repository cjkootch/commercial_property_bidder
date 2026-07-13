import { describe, expect, it } from "vitest";
import { ensureClaimLink } from "./claude";

const URL = "https://greenkeep.us/buyers/claim/abc123?trade=cleaning";

describe("ensureClaimLink (branches on intent, not prose)", () => {
  it("appends the link when a pitch drops it (the 2026-07-13 incident)", () => {
    const draft =
      "Cole with Greenkeep. We found a new business opening in San Antonio that needs cleaning — first one's free to claim.";
    const out = ensureClaimLink(draft, URL, [
      { direction: "out", body: "Hi, is this Maids on a Mission?" },
      { direction: "in", body: "Yes, how can we help?" },
    ], "pitch");
    expect(out).toContain(URL);
    expect(out.startsWith(draft)).toBe(true);
  });

  it("appends on an 'answer' that hasn't sent the link yet", () => {
    expect(ensureClaimLink("Yeah, straight from public permit filings.", URL, [], "answer")).toContain(URL);
  });

  it("leaves the draft alone when it already contains the link", () => {
    const draft = `Here it is, no charge: ${URL} — let me know if it's useful.`;
    expect(ensureClaimLink(draft, URL, [], "pitch")).toBe(draft);
  });

  it("does not re-send a link already delivered earlier in the thread", () => {
    const thread = [
      { direction: "out", body: `Your opportunity: ${URL}` },
      { direction: "in", body: "Are these verified?" },
    ];
    expect(ensureClaimLink("Yep, all verified.", URL, thread, "answer")).toBe("Yep, all verified.");
  });

  it("NEVER attaches a link to a handoff — even one the old regex would miss", () => {
    // "I'll have Cole reach out" never matched /\bCole will\b/ — intent catches it.
    const draft = "Understood — I'll have Cole reach out to you directly.";
    expect(ensureClaimLink(draft, URL, [], "handoff")).toBe(draft);
  });

  it("NEVER attaches a link to a close — even one the old phrase-list would miss", () => {
    const draft = "Understood — all the best."; // matched no close phrase before
    expect(ensureClaimLink(draft, URL, [], "close")).toBe(draft);
  });

  it("is a no-op when there is no link to deliver", () => {
    const draft = "Cole with Greenkeep — mind if I send over a local lead?";
    expect(ensureClaimLink(draft, null, [], "pitch")).toBe(draft);
  });
});
