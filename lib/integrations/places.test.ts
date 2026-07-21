import { describe, expect, it } from "vitest";
import { parsePlace } from "./places";

describe("parsePlace (Google Places → BuyerCandidate shape)", () => {
  it("parses a full result including the phone the SMS lane needs", () => {
    const c = parsePlace({
      displayName: { text: "GreenScape Lawn Pros " },
      websiteUri: "https://greenscapelawnpros.com",
      nationalPhoneNumber: "(281) 555-0142",
      addressComponents: [
        { types: ["street_number"], longText: "123" },
        { types: ["locality", "political"], longText: "Katy", shortText: "Katy" },
        { types: ["administrative_area_level_1", "political"], longText: "Texas", shortText: "TX" },
      ],
    });
    expect(c).toEqual({
      name: "GreenScape Lawn Pros",
      website: "https://greenscapelawnpros.com",
      city: "Katy",
      state: "TX",
      phone: "(281) 555-0142",
    });
  });

  it("a site-less, phone-only shop still becomes a candidate (SMS-reachable)", () => {
    const c = parsePlace({
      displayName: { text: "Joe's Mowing" },
      nationalPhoneNumber: "(832) 555-0100",
    });
    expect(c?.website).toBeNull();
    expect(c?.phone).toBe("(832) 555-0100");
  });

  it("nameless results are dropped", () => {
    expect(parsePlace({ websiteUri: "https://x.example" })).toBeNull();
    expect(parsePlace({ displayName: { text: "  " } })).toBeNull();
  });
});
