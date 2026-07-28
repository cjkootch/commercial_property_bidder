import { describe, expect, it } from "vitest";
import { htmlLooksCommercial, htmlMatchesVendor } from "./buyer-prospecting";
import { TRADES } from "../leads/trades";

// These were extracted from two functions that each fetched the SAME homepage
// with its own 8s timeout, then had the contact scraper fetch it a third time.
// Three sequential requests per candidate, up to want*3 candidates per run, is
// what killed /api/cron/demand at the 300s ceiling. Splitting fetch from
// judgement made the judgement testable, so it is tested.

describe("htmlLooksCommercial", () => {
  it("detects the commercial vocabulary a vendor site uses", () => {
    for (const html of [
      "<p>We serve HOA and property management clients</p>",
      "<h1>Commercial landscaping</h1>",
      "<div>office park and retail center maintenance</div>",
      "<span>industrial and municipal contracts</span>",
    ]) {
      expect(htmlLooksCommercial(html)).toBe(true);
    }
  });

  it("is case-insensitive and tolerates the spacing variants", () => {
    expect(htmlLooksCommercial("PROPERTY   MANAGEMENT")).toBe(true);
    expect(htmlLooksCommercial("property manage")).toBe(true);
  });

  it("returns false for a purely residential site", () => {
    expect(htmlLooksCommercial("<p>Weekly mowing for your home and yard</p>")).toBe(false);
  });

  it("returns NULL — not false — when there is no HTML to judge", () => {
    // The distinction matters downstream: "we could not read the site" is not
    // evidence that the company isn't commercial, and storing it as false
    // would be recording a fact we never learned.
    expect(htmlLooksCommercial(null)).toBeNull();
  });
});

describe("htmlMatchesVendor", () => {
  const re = TRADES.landscaping.vendorSignal;

  it("matches a site in the trade", () => {
    expect(htmlMatchesVendor("<h1>Landscaping and lawn care</h1>", re)).toBe(true);
  });

  it("rejects an adjacent vertical Apollo drags in", () => {
    // Apollo keyword search surfaces software vendors and suppliers; pitching
    // them a landscaping lead is spam.
    expect(htmlMatchesVendor("<h1>Enterprise billing software</h1>", re)).toBe(false);
  });

  it("fails CLOSED on unreadable HTML, unlike the commercial check", () => {
    // Asymmetry on purpose: the vertical gate is what stops a wrong-trade
    // pitch, so an unreadable site must not pass it. The commercial signal is
    // only a scoring hint, so it fails to null instead.
    expect(htmlMatchesVendor(null, re)).toBe(false);
  });

  it("each trade's signal rejects a different trade's copy", () => {
    expect(htmlMatchesVendor("<h1>Pest control experts</h1>", TRADES.pest.vendorSignal)).toBe(true);
    expect(htmlMatchesVendor("<h1>Pest control experts</h1>", re)).toBe(false);
  });
});
