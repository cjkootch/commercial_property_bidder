import { describe, it, expect } from "vitest";
import { orthogonalizeRing } from "./orthogonalize";

type LngLat = [number, number];

// Interior angle at b for a->b->c, in degrees. Project to a local metric frame
// first — lng/lat degrees are anisotropic at this latitude, so a metric-square
// corner would not read as 90° in raw degree space.
const KX = Math.cos((30.1 * Math.PI) / 180); // lng scale at ~lat 30.1
function angleDeg(a: LngLat, b: LngLat, c: LngLat): number {
  const v1 = [(a[0] - b[0]) * KX, a[1] - b[1]];
  const v2 = [(c[0] - b[0]) * KX, c[1] - b[1]];
  const dot = v1[0] * v2[0] + v1[1] * v2[1];
  const m1 = Math.hypot(v1[0], v1[1]);
  const m2 = Math.hypot(v2[0], v2[1]);
  return (Math.acos(dot / (m1 * m2)) * 180) / Math.PI;
}

describe("orthogonalizeRing", () => {
  it("snaps a slightly-noisy near-rectangle to clean 90° corners", () => {
    // ~a small rectangle near Tomball with jittered corners.
    const noisy: LngLat[] = [
      [-95.6000, 30.1000],
      [-95.5990, 30.10005],
      [-95.59895, 30.10055],
      [-95.60005, 30.1005],
      [-95.6000, 30.1000],
    ];
    const out = orthogonalizeRing(noisy);
    // Closed ring, same vertex count.
    expect(out[0]).toEqual(out[out.length - 1]);
    expect(out.length).toBe(noisy.length);
    // Every interior corner should be ~90°.
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[(i - 1 + (out.length - 1)) % (out.length - 1)];
      const b = out[i];
      const c = out[(i + 1) % (out.length - 1)];
      expect(Math.abs(angleDeg(a, b, c) - 90)).toBeLessThan(2);
    }
  });

  it("leaves a tiny/degenerate ring unchanged", () => {
    const tri: LngLat[] = [
      [-95.6, 30.1],
      [-95.599, 30.1],
      [-95.6, 30.1005],
    ];
    expect(orthogonalizeRing(tri)).toBe(tri);
  });

  it("does not orthogonalize a clearly round (non-grid) ring", () => {
    const circle: LngLat[] = [];
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * 2 * Math.PI;
      circle.push([-95.6 + 0.0005 * Math.cos(t), 30.1 + 0.0005 * Math.sin(t)]);
    }
    circle.push(circle[0]);
    // Guard should return the input unchanged.
    expect(orthogonalizeRing(circle)).toBe(circle);
  });
});
