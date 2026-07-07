import { describe, expect, it } from "vitest";
import { draftConfidence } from "./confidence";

describe("draftConfidence", () => {
  it("is Low with no confidence data", () => {
    expect(draftConfidence(null, 0.5).level).toBe("Low");
    expect(draftConfidence(undefined, 0.5).level).toBe("Low");
  });

  it("is Low without an RGB cross-check, no matter the margin", () => {
    expect(draftConfidence({ turf_margin: 0.99, mean_margin: 0.9, veg_frac: 0.5 }, null).level).toBe("Low");
  });

  it("is Med only when the model is decisive AND agrees with RGB", () => {
    expect(draftConfidence({ turf_margin: 0.8, mean_margin: 0.8, veg_frac: 0.5 }, 0.55).level).toBe("Med");
  });

  it("is Low when decisive but disagreeing with RGB (confidently wrong)", () => {
    expect(draftConfidence({ turf_margin: 0.9, mean_margin: 0.9, veg_frac: 0.8 }, 0.3).level).toBe("Low");
  });

  it("is Low when agreeing but indecisive", () => {
    expect(draftConfidence({ turf_margin: 0.5, mean_margin: 0.5, veg_frac: 0.5 }, 0.5).level).toBe("Low");
  });
});
