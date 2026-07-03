import { NextRequest } from "next/server";
import { getMapboxToken } from "@/lib/integrations/geocoding";
import { rateLimit, clientIp, LIMITS } from "@/lib/ratelimit";

// Aerial-preview proxy: renders a Mapbox satellite static image for a given
// lng/lat so the instant-quote "measuring" screen can show the customer their
// actual property from above. Proxying keeps MAPBOX_API server-side (works with
// either a pk. or sk. token) and never ships it to the browser.
export const dynamic = "force-dynamic";

const clampZoom = (z: number) => Math.min(20, Math.max(14, Number.isFinite(z) ? z : 18));

export async function GET(req: NextRequest) {
  const token = getMapboxToken();
  if (!token) return new Response("Preview unavailable", { status: 404 });

  // Public route that spends Mapbox quota per call — cap per IP.
  const rl = await rateLimit(`preview:ip:${clientIp()}`, LIMITS.preview_ip.limit, LIMITS.preview_ip.windowSec);
  if (!rl.ok) return new Response("Too many requests", { status: 429 });

  const sp = req.nextUrl.searchParams;
  const lng = Number(sp.get("lng"));
  const lat = Number(sp.get("lat"));
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    return new Response("Bad coordinates", { status: 400 });
  }
  const zoom = clampZoom(Number(sp.get("zoom")));

  const url =
    `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/` +
    `${lng},${lat},${zoom},0/512x512@2x?access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return new Response("Preview unavailable", { status: 502 });
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") || "image/png",
        // Tiles for a fixed point don't change minute to minute; let the browser/CDN cache.
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response("Preview unavailable", { status: 502 });
  }
}
