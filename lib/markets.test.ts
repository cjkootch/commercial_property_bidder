import { describe, expect, it } from "vitest";
import { MARKETS, marketByKey, marketForCoords } from "./markets";

describe("markets registry", () => {
  it("resolves a market from lead coordinates", () => {
    expect(marketForCoords(29.76, -95.36).key).toBe("houston"); // downtown Houston
    expect(marketForCoords(32.78, -96.8).key).toBe("dallas"); // downtown Dallas
    expect(marketForCoords(32.75, -97.33).key).toBe("dallas"); // downtown Fort Worth
    expect(marketForCoords(28.54, -81.38).key).toBe("orlando"); // downtown Orlando, FL
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
      // LGBS tax-sale + TABC are TEXAS feeds — Texas metros must name their
      // counties; non-Texas metros (e.g. Orlando) source from their own state
      // feeds, so the arrays exist but are legitimately empty.
      expect(Array.isArray(m.taxSaleCounties)).toBe(true);
      expect(Array.isArray(m.tabcCounties)).toBe(true);
      if ((m.state ?? "TX") === "TX") {
        expect(m.taxSaleCounties.length).toBeGreaterThan(0);
        expect(m.tabcCounties.length).toBeGreaterThan(0);
      }
      // Portals may legitimately be EMPTY (Waco: no area agency runs Bonfire
      // — verified live 2026-07-10; the RFP cron no-ops). The field must
      // still exist so the feed can iterate it.
      expect(Array.isArray(m.bonfirePortals)).toBe(true);
      expect(m.bbox[0]).toBeLessThan(m.bbox[2]); // west < east
      expect(m.bbox[1]).toBeLessThan(m.bbox[3]); // south < north
    }
  });

  it("market bboxes never overlap (a lead belongs to exactly one metro)", () => {
    const all = Object.values(MARKETS);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const [aw, as, ae, an] = all[i].bbox;
        const [bw, bs, be, bn] = all[j].bbox;
        const overlaps = aw < be && bw < ae && as < bn && bs < an;
        expect(overlaps, `${all[i].key} overlaps ${all[j].key}`).toBe(false);
      }
    }
  });
});
