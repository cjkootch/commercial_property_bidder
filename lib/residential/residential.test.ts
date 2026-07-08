import { describe, it, expect } from "vitest";
import { scoreSignal, getConfidenceMultiplier, calculateLeadScore } from "./scoring";
import { calculateLtv } from "./ltv";
import { buildPackageTeaser } from "./teaser";
import type { ResidentialLead } from "../db/schema";

describe("Residential Logic", () => {
  describe("Scoring", () => {
    it("should score signals correctly", () => {
      expect(scoreSignal("new_construction")).toBe(100);
      expect(scoreSignal("recently_sold")).toBe(80);
      expect(scoreSignal("newly_listed")).toBe(60);
      expect(scoreSignal("manual")).toBe(20);
    });

    it("should apply confidence multipliers", () => {
      expect(getConfidenceMultiplier("High")).toBe(1.0);
      expect(getConfidenceMultiplier("Med")).toBe(0.7);
      expect(getConfidenceMultiplier("Low")).toBe(0.4);
    });

    it("should calculate lead score correctly", () => {
      expect(calculateLeadScore("new_construction", "High")).toBe(100);
      expect(calculateLeadScore("recently_sold", "Med")).toBe(56); // 80 * 0.7
      expect(calculateLeadScore("manual", "Low")).toBe(8); // 20 * 0.4
    });
  });

  describe("LTV", () => {
    it("should calculate LTV within a reasonable range", () => {
      const ltv = calculateLtv({ baseMonthlyValue: 100, expectedMonthsRetained: 12 });
      // base = 1200
      // low = 1200 * 0.75 = 900
      // high = 1200 * 1.25 + 500 = 1500 + 500 = 2000
      expect(ltv.low).toBe(900);
      expect(ltv.high).toBe(2000);
    });
  });

  describe("Teaser", () => {
    it("should build a teaser from leads", () => {
      const mockLeads: Partial<ResidentialLead>[] = [
        {
          signal_type: "new_construction",
          confidence: "High",
          city: "Houston",
          zip: "77001",
          subdivision_name: "Oak Estates",
        },
        {
          signal_type: "recently_sold",
          confidence: "Med",
          city: "Houston",
          zip: "77001",
          subdivision_name: "Oak Estates",
        },
      ];

      const teaser = buildPackageTeaser(mockLeads as ResidentialLead[]);

      expect(teaser.leadCount).toBe(2);
      expect(teaser.strongestSignal).toBe("new_construction");
      expect(teaser.cities).toContain("Houston");
      expect(teaser.zips).toContain("77001");
      expect(teaser.subdivisions).toContain("Oak Estates");
      expect(teaser.ltvRange.low).toBeGreaterThan(0);
      expect(teaser.ltvRange.high).toBeGreaterThan(teaser.ltvRange.low);
    });
  });
});
