import { describe, expect, it } from "vitest";
import { orgNameMatches, pickDecisionPerson, pickMobileNumber } from "./apollo";

describe("integrations/apollo pickMobileNumber", () => {
  it("prefers a mobile-typed number over a work line", () => {
    expect(
      pickMobileNumber([
        { sanitized_number: "+18325551000", type: "work_hq" },
        { sanitized_number: "+18325559999", type: "mobile" },
      ])
    ).toBe("+18325559999");
  });
  it("matches the type_cd field and cell wording", () => {
    expect(pickMobileNumber([{ sanitized_number: "+18325559999", type_cd: "mobile" }])).toBe("+18325559999");
    expect(pickMobileNumber([{ sanitized_number: "+18325559999", type: "Cell Phone" }])).toBe("+18325559999");
  });
  it("returns null when only a work/main line exists (not worth swapping)", () => {
    expect(pickMobileNumber([{ sanitized_number: "+18325551000", type: "work_hq" }])).toBeNull();
    expect(pickMobileNumber([])).toBeNull();
    expect(pickMobileNumber(undefined)).toBeNull();
  });
});

// The gates that keep a WRONG person off a sold sheet — worse than none.
describe("integrations/apollo decision-contact gates", () => {
  it("orgNameMatches requires a significant-token overlap", () => {
    expect(orgNameMatches("BAYOU CLUB OF HOUSTON", "Bayou Club")).toBe(true);
    expect(orgNameMatches("ACME HOLDINGS LLC", "Acme Industrial Services")).toBe(true);
    // Stopwords never match on their own: LLC/properties/group carry nothing.
    expect(orgNameMatches("SMITH PROPERTIES LLC", "Jones Properties Group")).toBe(false);
    expect(orgNameMatches("THE LLC", "Another LLC")).toBe(false);
    expect(orgNameMatches("ACME HOLDINGS", null)).toBe(false);
  });

  it("pickDecisionPerson ranks by who actually awards contracts", () => {
    const people = [
      { name: "A", title: "Marketing Coordinator" },
      { name: "B", title: "Facilities Manager" },
      { name: "C", title: "Owner" },
      { name: "D", title: "President" },
    ];
    expect(pickDecisionPerson(people)?.name).toBe("C");
    expect(pickDecisionPerson(people.filter((p) => p.name !== "C"))?.name).toBe("D");
    expect(pickDecisionPerson(people.filter((p) => !["C", "D"].includes(p.name)))?.name).toBe("B");
    // Nobody with a ranked title -> first person rather than nothing.
    expect(pickDecisionPerson([{ name: "Z", title: "Analyst" }])?.name).toBe("Z");
    expect(pickDecisionPerson([])).toBeNull();
  });
});

import { findCompanyEmail } from "./apollo";

describe("integrations/apollo findCompanyEmail domain gate", () => {
  // No key in tests -> returns null without hitting the network.
  it("returns null without an API key (safe default)", async () => {
    const prev = process.env.APOLLO_API_KEY;
    const prev2 = process.env.APOLLO_API;
    delete process.env.APOLLO_API_KEY;
    delete process.env.APOLLO_API;
    expect(await findCompanyEmail("Acme Pest Control", { domain: "acmepest.com" })).toBeNull();
    expect(await findCompanyEmail("", {})).toBeNull();
    if (prev) process.env.APOLLO_API_KEY = prev;
    if (prev2) process.env.APOLLO_API = prev2;
  });
});
