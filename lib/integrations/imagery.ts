// RGB vegetation detection (free, no ML) for a first-pass serviceable-area
// estimate. Fetches a Mapbox Static satellite image of the parcel, classifies
// each pixel inside the parcel polygon as vegetation (Excess Green Index), and
// returns an estimated turf area plus a mask overlay so the operator can SEE
// and audit what was detected.
//
// Caveats (surfaced in the UI): "vegetation" includes tree canopy, not just
// mowable grass; it's sensitive to imagery season/shadows. It's a draft to
// refine, not ground truth.

import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import area from "@turf/area";
import type { ParcelResult } from "../geo/types";
import { M2_TO_SQFT } from "../geo/area";

type LngLat = [number, number];

const MAX_DIM = 1024;

function parcelRings(p: ParcelResult): LngLat[][] {
  if (p.geometry.type === "Polygon") {
    return [(p.geometry.coordinates as number[][][])[0] as LngLat[]];
  }
  return (p.geometry.coordinates as number[][][][]).map((poly) => poly[0] as LngLat[]);
}

function bboxOf(rings: LngLat[][]): [number, number, number, number] {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLng, minLat, maxLng, maxLat];
}

function pointInRing([x, y]: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Excess Green Index classifier — illumination-normalized. */
function isVegetation(r: number, g: number, b: number): boolean {
  const total = r + g + b;
  if (total < 60) return false; // too dark: shadow / water / asphalt
  const exg = (2 * g - r - b) / total;
  return exg > 0.06 && g >= r && g >= b * 0.9;
}

export type ServiceableEstimate = {
  turf_sqft: number;
  vegetation_fraction: number;
  parcel_area_sqft: number;
  /** data: URL of a translucent mask (green where vegetation detected). */
  mask_data_url: string;
  /** Image-source corners: TL, TR, BR, BL as [lng,lat]. */
  coordinates: [LngLat, LngLat, LngLat, LngLat];
};

/** A fetched satellite tile for a parcel, with the geo bounds needed to align
 *  pixels to lng/lat (for masking / rasterizing training labels). */
export type ParcelTile = {
  width: number;
  height: number;
  /** RGBA pixels, row-major. */
  data: Uint8Array;
  /** JPEG bytes as received (for saving training images without re-encoding). */
  jpeg: Buffer;
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  /** Image-source corners: TL, TR, BR, BL as [lng,lat]. */
  coordinates: [LngLat, LngLat, LngLat, LngLat];
};

/**
 * Fetch a Mapbox Static satellite image covering the parcel bbox, aspect-matched
 * to ground (mercator) to avoid distortion. Shared by the vegetation estimator
 * and the ML training-data exporter so image and mask use identical tiling.
 */
export async function fetchParcelTile(
  parcel: ParcelResult,
  token: string | null
): Promise<ParcelTile | null> {
  if (!token) return null;
  const rings = parcelRings(parcel);
  if (!rings.length) return null;

  const [minLng, minLat, maxLng, maxLat] = bboxOf(rings);
  const midLat = ((minLat + maxLat) * (Math.PI / 180)) / 2;
  const lngSpan = maxLng - minLng;
  const latSpan = maxLat - minLat;
  if (lngSpan <= 0 || latSpan <= 0) return null;

  const aspect = (lngSpan * Math.cos(midLat)) / latSpan;
  let w = MAX_DIM;
  let h = Math.round(w / aspect);
  if (h > MAX_DIM) {
    h = MAX_DIM;
    w = Math.round(h * aspect);
  }
  w = Math.max(1, Math.min(MAX_DIM, w));
  h = Math.max(1, Math.min(MAX_DIM, h));

  const bbox = `[${minLng},${minLat},${maxLng},${maxLat}]`;
  const url =
    `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${bbox}/${w}x${h}` +
    `?access_token=${encodeURIComponent(token)}&attribution=false&logo=false&padding=0`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[imagery] parcel tile fetch ${res.status} for bbox ${bbox}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    return {
      width: img.width,
      height: img.height,
      data: img.data,
      jpeg: buf,
      minLng,
      minLat,
      maxLng,
      maxLat,
      coordinates: [
        [minLng, maxLat],
        [maxLng, maxLat],
        [maxLng, minLat],
        [minLng, minLat],
      ],
    };
  } catch (e) {
    console.warn(`[imagery] parcel tile failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Estimate the vegetated (≈ serviceable) area within a parcel from satellite
 * imagery. Area is computed as a fraction of the known parcel area, so it's
 * robust to map projection. Returns null on missing token/parcel or fetch error.
 */
export async function estimateServiceableArea(
  parcel: ParcelResult,
  token: string | null
): Promise<ServiceableEstimate | null> {
  const tile = await fetchParcelTile(parcel, token);
  if (!tile) return null;
  const rings = parcelRings(parcel);
  const { width, height, data, minLng, minLat, maxLng, maxLat } = tile;
  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;

  const mask = new PNG({ width, height });
  let total = 0;
  let veg = 0;

  for (let py = 0; py < height; py++) {
    // Linear pixel -> lng/lat across the bbox (negligible error at parcel scale).
    const lat = maxLat - (py + 0.5) * (latSpan / height);
    for (let px = 0; px < width; px++) {
      const lng = minLng + (px + 0.5) * (lngSpan / width);
      const idx = (width * py + px) << 2;
      if (!rings.some((r) => pointInRing([lng, lat], r))) continue;
      total++;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      if (isVegetation(r, g, b)) {
        veg++;
        mask.data[idx] = 63;
        mask.data[idx + 1] = 224;
        mask.data[idx + 2] = 94;
        mask.data[idx + 3] = 130; // translucent green
      } else {
        mask.data[idx + 3] = 0;
      }
    }
  }

  if (total === 0) return null;
  const fraction = veg / total;
  const parcel_area_sqft = area(
    { type: "Feature", properties: {}, geometry: parcel.geometry } as GeoJSON.Feature
  ) * M2_TO_SQFT;

  const maskBuf = PNG.sync.write(mask);
  const mask_data_url = "data:image/png;base64," + maskBuf.toString("base64");

  return {
    turf_sqft: Math.round(parcel_area_sqft * fraction),
    vegetation_fraction: fraction,
    parcel_area_sqft: Math.round(parcel_area_sqft),
    mask_data_url,
    coordinates: [
      [minLng, maxLat],
      [maxLng, maxLat],
      [maxLng, minLat],
      [minLng, minLat],
    ],
  };
}
