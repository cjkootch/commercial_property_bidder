import { describe, expect, it, vi } from "vitest";

// The identity brief exists because deflecting "where are you based?" cost a
// live conversation on 2026-07-30 — Space City Air Duct opened their claim
// link, asked twice, got "Cole will follow up" twice, and went quiet. These
// tests pin the two properties that matter: it ANSWERS, and it never invents
// premises the company record doesn't have.

const loadWith = async (co: Record<string, unknown> | null) => {
  vi.resetModules();
  vi.doMock("@/lib/db/queries", () => ({
    getDefaultCompany: async () => co,
    listDashboard: async () => [],
  }));
  vi.doMock("@/lib/db", () => ({ db: {} }));
  return (await import("./ai-context")).companyIdentityBrief;
};

const FULL = {
  name: "Greenkeep",
  slug: "greenkeep",
  city: "Tomball",
  zip: "77375",
  email: "leads@greenkeep.us",
  phone: null,
  booking_url: "https://cal.com/nwhcg/walkthrough",
  service_area_notes: "Tomball / Spring / Cypress / Magnolia corridor.",
};

describe("companyIdentityBrief", () => {
  it("states the town plainly, which is the question that got deflected", async () => {
    const brief = await (await loadWith(FULL))();
    expect(brief).toContain("Tomball");
    expect(brief).toContain("77375");
    expect(brief).toMatch(/Say the town plainly/i);
  });

  it("instructs the model NOT to deflect identity questions", async () => {
    const brief = await (await loadWith(FULL))();
    expect(brief).toMatch(/never deflect these to Cole/i);
  });

  it("explains how we got their number, unprompted", async () => {
    // "How did you get my number" is the other trust question, and the honest
    // answer — published on their own site — is disarming.
    const brief = await (await loadWith(FULL))();
    expect(brief).toMatch(/published on their own website|public business listing/i);
    expect(brief).toMatch(/not a data broker/i);
  });

  it("makes clear we are not a competitor for the work", async () => {
    const brief = await (await loadWith(FULL))();
    expect(brief).toMatch(/not a contractor/i);
  });

  it("NEVER invents a street address when the record has none", async () => {
    const brief = await (await loadWith(FULL))();
    expect(brief).toMatch(/do NOT invent an address/i);
    // Nothing that looks like a street line.
    expect(brief).not.toMatch(/\d+\s+\w+\s+(St|Ave|Rd|Blvd|Ln|Dr)\b/);
  });

  it("omits contact lines the record doesn't have", async () => {
    const brief = await (await loadWith({ ...FULL, phone: null, booking_url: null }))();
    expect(brief).not.toMatch(/^- Phone:/m);
    expect(brief).not.toMatch(/book one/i);
  });

  it("includes phone and booking link when the record DOES have them", async () => {
    const brief = await (await loadWith({ ...FULL, phone: "+18325550100" }))();
    expect(brief).toContain("+18325550100");
    expect(brief).toContain("cal.com/nwhcg/walkthrough");
  });

  it("degrades to an empty string rather than throwing when there is no company", async () => {
    // The AI reply path must survive this: a missing brief costs one deflection,
    // an exception costs the whole reply.
    expect(await (await loadWith(null))()).toBe("");
  });
});
