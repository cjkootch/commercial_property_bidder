import { describe, expect, it } from "vitest";
import { buildPackagePitch } from "./residential-demand";

const PKG = {
  name: "Fort Worth Residential New Mover Report",
  lead_count: 418,
  price_cents: 12500,
};

describe("buildPackagePitch", () => {
  it("builds an honest A-variant pitch with count, price, and CTA", () => {
    const m = buildPackagePitch({
      subjectVariant: "A",
      company: "Green Lawns LLC",
      pkg: PKG,
      geography: "Fort Worth",
      trade: "landscaping",
      brand: "Greenkeep",
      replyEmail: "leads@greenkeep.us",
      ctaUrl: "https://greenkeep.us/buyers/signup?respkg=x&trade=landscaping",
    });
    expect(m.subject).toBe("418 new homeowners in Fort Worth for $125");
    expect(m.body).toContain("Green Lawns LLC");
    expect(m.body).toContain("418 addresses");
    expect(m.body).toContain("$125 one-time");
    expect(m.body).toContain("https://greenkeep.us/buyers/signup?respkg=x&trade=landscaping");
    // HONESTY INVARIANTS: county-record provenance disclosed, no false
    // urgency — deed data lags, so "this week"-style claims would be lies.
    expect(m.body).toContain("county deed records");
    expect(m.body.toLowerCase()).toContain("past months");
    expect(m.body.toLowerCase()).not.toContain("this week");
    expect(m.body.toLowerCase()).not.toContain("today");
  });

  it("B variant leads with the who-just-bought angle", () => {
    const m = buildPackagePitch({
      subjectVariant: "B",
      company: "X",
      pkg: PKG,
      geography: "Fort Worth",
      trade: "pest",
      brand: "Greenkeep",
      replyEmail: null,
      ctaUrl: "https://x",
    });
    expect(m.subject).toBe("Who just bought a home in Fort Worth — 418 verified addresses");
    // Trade voice: pest copy speaks pest, not landscaping.
    expect(m.body).toContain("pest control");
  });
});
