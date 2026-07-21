import { describe, expect, it } from "vitest";
import { isLowVolume, LOW_VOLUME_RATIO } from "./low-volume";

describe("isLowVolume (the 45→0 decay tripwire)", () => {
  it("launch-day outcomes would have paged: 0/90 and 4/150", () => {
    expect(isLowVolume(0, 90)).toBe(true);
    expect(isLowVolume(4, 150)).toBe(true);
  });

  it("a healthy day stays quiet", () => {
    expect(isLowVolume(27, 90)).toBe(false);
    expect(isLowVolume(150, 150)).toBe(false);
  });

  it("the boundary sits at the ratio", () => {
    const cap = 100;
    const threshold = Math.ceil(cap * LOW_VOLUME_RATIO); // 20
    expect(isLowVolume(threshold - 1, cap)).toBe(true);
    expect(isLowVolume(threshold, cap)).toBe(false);
  });

  it("a zero cap never pages (misconfig, not starvation)", () => {
    expect(isLowVolume(0, 0)).toBe(false);
  });
});
