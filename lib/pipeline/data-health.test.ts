import { describe, expect, it } from "vitest";
import { evaluateMetric, emailLooksReal, geoLooksValid } from "./data-health";

describe("data-health evaluateMetric", () => {
  it("breaches when the bad rate exceeds the threshold on a real sample", () => {
    const m = evaluateMetric("phones", 100, 40, 0.35);
    expect(m.badPct).toBe(40);
    expect(m.breached).toBe(true);
  });
  it("does not breach at or below threshold", () => {
    expect(evaluateMetric("phones", 100, 35, 0.35).breached).toBe(false);
    expect(evaluateMetric("phones", 100, 10, 0.35).breached).toBe(false);
  });
  it("never breaches on a tiny sample (< 25) — avoids false alarms", () => {
    const m = evaluateMetric("phones", 10, 10, 0.35); // 100% bad but N=10
    expect(m.badPct).toBe(100);
    expect(m.breached).toBe(false);
  });
  it("handles an empty table without dividing by zero", () => {
    const m = evaluateMetric("phones", 0, 0, 0.35);
    expect(m.badPct).toBe(0);
    expect(m.breached).toBe(false);
  });
});

describe("data-health field validators", () => {
  it("emailLooksReal accepts real, rejects placeholder/fake/malformed", () => {
    expect(emailLooksReal("jane@acme.com")).toBe(true);
    expect(emailLooksReal("verify-123@example.com")).toBe(false);
    expect(emailLooksReal("test@test.com")).toBe(false);
    expect(emailLooksReal("not-an-email")).toBe(false);
    expect(emailLooksReal(null)).toBe(false);
  });
  it("geoLooksValid accepts continental US, rejects null/zero/out-of-range", () => {
    expect(geoLooksValid(29.76, -95.37)).toBe(true); // Houston
    expect(geoLooksValid(28.54, -81.38)).toBe(true); // Orlando
    expect(geoLooksValid(0, 0)).toBe(false);
    expect(geoLooksValid(null, -95)).toBe(false);
    expect(geoLooksValid(51.5, -0.12)).toBe(false); // London
  });
});
