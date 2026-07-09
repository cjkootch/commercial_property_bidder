import { describe, expect, it } from "vitest";
import { orgNameMatches, pickDecisionPerson } from "./apollo";

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
