import { describe, expect, it } from "vitest";
import { MARKETS, marketByKey, marketForCoords } from "./markets";

describe("markets registry", () => {
  it("resolves a market from lead coordinates", () => {
    expect(marketForCoords(29.76, -95.36).key).toBe("houston"); // downtown Houston
    expect(marketForCoords(32.78, -96.8).key).toBe("dallas"); // downtown Dallas
    expect(marketForCoords(32.75, -97.33).key).toBe("dallas"); // downtown Fort Worth
    // Outside every bbox (or unknown) -> the deployment default.
    expect(marketForCoords(40.7, -74.0).key).toBe("houston");
    expect(marketForCoords(null, null).key).toBe("houston");
  });

  it("resolves explicit market keys with a safe default", () => {
    expect(marketByKey("dallas").key).toBe("dallas");
    expect(marketByKey("DALLAS").key).toBe("dallas");
    expect(marketByKey("atlantis").key).toBe("houston");
    expect(marketByKey(null).key).toBe("houston");
  });

  it("every market carries the fields the feeds read", () => {
    for (const m of Object.values(MARKETS)) {
      expect(m.taxSaleCounties.length).toBeGreaterThan(0);
      expect(m.tabcCounties.length).toBeGreaterThan(0);
      expect(m.bonfirePortals.length).toBeGreaterThan(0);
      expect(m.bbox[0]).toBeLessThan(m.bbox[2]); // west < east
      expect(m.bbox[1]).toBeLessThan(m.bbox[3]); // south < north
    }
  });
});
