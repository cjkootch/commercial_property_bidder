import { describe, expect, it } from "vitest";
import { cityScarcityLine } from "./activity";

describe("cityScarcityLine", () => {
  it("says nothing when there's nothing true to say", () => {
    expect(cityScarcityLine(0, "Houston")).toBeNull();
    expect(cityScarcityLine(3, null)).toBeNull();
    expect(cityScarcityLine(3, "  ")).toBeNull();
  });
  it("uses singular grammar for one claim", () => {
    const line = cityScarcityLine(1, "Houston");
    expect(line).toContain("1 company near Houston has claimed");
  });
  it("uses plural grammar for multiple and names the city", () => {
    const line = cityScarcityLine(4, "San Antonio");
    expect(line).toContain("4 companies near San Antonio have claimed");
    expect(line).toContain("last month");
  });
  it("trims the city", () => {
    expect(cityScarcityLine(2, "  Austin  ")).toContain("near Austin have");
  });
});
