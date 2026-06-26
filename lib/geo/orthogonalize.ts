// Orthogonalize building footprints: snap edges to a single dominant right-angle
// grid so traced/【OSM】 polygons get clean 90° corners. Works in a local planar
// (equirectangular) frame around the ring centroid so angles are metric-correct,
// then maps back to lng/lat.
//
// Buildings are overwhelmingly axis-aligned, so this is a safe polish. Shapes
// that are clearly NOT grid-like (round/diagonal) are left untouched (guard).

type LngLat = [number, number];

const HALF_PI = Math.PI / 2;

/** Open a (possibly closed) ring and drop near-duplicate consecutive vertices. */
function openRing(ring: LngLat[]): LngLat[] {
  const pts = ring.slice();
  if (pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) pts.pop();
  }
  const out: LngLat[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-12 || Math.abs(last[1] - p[1]) > 1e-12) out.push(p);
  }
  return out;
}

/** Length-weighted dominant orientation of the edges, folded into [0, 90°). */
function dominantAngle(edges: { len: number; ang: number }[]): number {
  // Fold 90° periodicity onto a full circle by ×4, average, divide back.
  let sx = 0;
  let sy = 0;
  for (const e of edges) {
    sx += e.len * Math.cos(e.ang * 4);
    sy += e.len * Math.sin(e.ang * 4);
  }
  return Math.atan2(sy, sx) / 4;
}

/** Nearest direction on the {theta + k·90°} grid to `ang`. */
function snapDir(ang: number, theta: number): number {
  return theta + Math.round((ang - theta) / HALF_PI) * HALF_PI;
}

/**
 * Orthogonalize a single ring (array of [lng,lat]). Returns a closed ring
 * (last === first). Returns the input unchanged when it's too small or clearly
 * not rectilinear (mean edge deviation from the grid exceeds `maxDevDeg`).
 */
export function orthogonalizeRing(ring: LngLat[], maxDevDeg = 22): LngLat[] {
  const pts = openRing(ring);
  const N = pts.length;
  if (N < 4) return ring;

  const lat0 = pts.reduce((s, p) => s + p[1], 0) / N;
  const lng0 = pts.reduce((s, p) => s + p[0], 0) / N;
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const xy: LngLat[] = pts.map(([lng, lat]) => [(lng - lng0) * mPerLng, (lat - lat0) * mPerLat]);

  const edges = xy.map((a, i) => {
    const b = xy[(i + 1) % N];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    return { len: Math.hypot(dx, dy), ang: Math.atan2(dy, dx) };
  });

  const theta = dominantAngle(edges);

  // Guard: bail if the footprint isn't grid-like (curved/diagonal building).
  let wDev = 0;
  let wLen = 0;
  for (const e of edges) {
    if (e.len < 1e-6) continue;
    const dev = Math.abs(e.ang - snapDir(e.ang, theta));
    wDev += e.len * dev;
    wLen += e.len;
  }
  if (wLen === 0 || (wDev / wLen) > (maxDevDeg * Math.PI) / 180) return ring;

  // Work in the grid frame (rotate by -theta), so snapped edges are pure ±x / ±y.
  const cs = Math.cos(-theta);
  const sn = Math.sin(-theta);
  const rot = ([x, y]: LngLat): LngLat => [x * cs - y * sn, x * sn + y * cs];
  const inv = ([x, y]: LngLat): LngLat => [x * cs + y * sn, -x * sn + y * cs];
  const xr = xy.map(rot);

  // Snap each edge to the nearer axis; keep its length.
  const ex = new Array<number>(N);
  const ey = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    const a = xr[i];
    const b = xr[(i + 1) % N];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (Math.abs(dx) >= Math.abs(dy)) {
      ex[i] = Math.sign(dx || 1) * len;
      ey[i] = 0;
    } else {
      ex[i] = 0;
      ey[i] = Math.sign(dy || 1) * len;
    }
  }

  // Force closure by adjusting edge LENGTHS (not directions): spread the x/y
  // residual across the horizontal/vertical edges proportionally, so every
  // corner stays an exact right angle.
  const sumX = ex.reduce((s, v) => s + v, 0);
  const sumY = ey.reduce((s, v) => s + v, 0);
  const absX = ex.reduce((s, v) => s + Math.abs(v), 0);
  const absY = ey.reduce((s, v) => s + Math.abs(v), 0);
  for (let i = 0; i < N; i++) {
    if (ex[i] !== 0 && absX > 0) ex[i] -= sumX * (Math.abs(ex[i]) / absX);
    if (ey[i] !== 0 && absY > 0) ey[i] -= sumY * (Math.abs(ey[i]) / absY);
  }

  // Rebuild vertices (closing edge is implied — residual is now zero).
  const vr: LngLat[] = new Array(N);
  vr[0] = xr[0];
  for (let i = 0; i < N - 1; i++) vr[i + 1] = [vr[i][0] + ex[i], vr[i][1] + ey[i]];

  const ll: LngLat[] = vr.map((p) => {
    const [x, y] = inv(p);
    return [lng0 + x / mPerLng, lat0 + y / mPerLat] as LngLat;
  });
  ll.push([ll[0][0], ll[0][1]]); // close
  return ll;
}

/** Orthogonalize every ring of a Polygon coordinate array. */
export function orthogonalizePolygon(coords: number[][][]): number[][][] {
  return coords.map((ring) => orthogonalizeRing(ring as LngLat[]));
}
