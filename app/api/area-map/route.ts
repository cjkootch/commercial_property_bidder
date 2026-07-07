import { NextRequest } from "next/server";
import { getMapboxToken } from "@/lib/integrations/geocoding";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// Static streets map for the profile service-area picker. Server-side token
// (works with pk or sk); wider zoom range than /api/property-preview so a whole
// service radius fits. The radius circle itself is drawn as an SVG overlay
// client-side, so panning the slider never refetches this image.
export const dynamic = "force-dynamic";

const clampZoom = (z: number) => Math.min(15, Math.max(4, Number.isFinite(z) ? z : 9));

export async function GET(req: NextRequest) {
  const token = getMapboxToken();
  if (!token) return new Response("Map unavailable", { status: 404 });

  const rl = await rateLimit(`areamap:ip:${clientIp()}`, 60, 3600);
  if (!rl.ok) return new Response("Too many requests", { status: 429 });

  const sp = req.nextUrl.searchParams;
  const lng = Number(sp.get("lng"));
  const lat = Number(sp.get("lat"));
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    return new Response("Bad coordinates", { status: 400 });
  }
  const zoom = clampZoom(Number(sp.get("zoom")));

  const url =
    `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/` +
    `${lng},${lat},${zoom},0/512x512@2x?access_token=${encodeURIComponent(token)}&attribution=false&logo=false`;
  try {
    const res = await fetch(url);
    if (!res.ok) return new Response("Map unavailable", { status: 502 });
    return new Response(await res.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") || "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response("Map unavailable", { status: 502 });
  }
}
