import { NextResponse, type NextRequest } from "next/server";
import { resolveShortLink } from "@/lib/links/shorten";

// Short-link redirect. The code is an envelope around a signed claim URL — all
// the authority still lives in the token this redirects to, so this route makes
// no authorization decision of its own.
//
// Must be PUBLIC (see middleware PUBLIC_PREFIXES): the whole point is that a
// stranger with a text message can open it.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { code: string } }
) {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://greenkeep.us").replace(/\/$/, "");

  let resolved;
  try {
    resolved = await resolveShortLink(params.code);
  } catch (e) {
    // A database blip must not look like a dead link to a prospect who is
    // actively trying to reach us — send them somewhere real.
    console.error("short link resolve failed:", e);
    return NextResponse.redirect(`${base}/commercial`, 302);
  }

  if ("target" in resolved) {
    // 302, not 301: these expire, and a permanent redirect would be cached by
    // the browser past the token's life.
    return NextResponse.redirect(resolved.target, 302);
  }

  // Expired or unknown. Land them on the public commercial page rather than a
  // 404 — someone following a real link we sent them deserves a way in, and the
  // claim page itself will explain if the specific job has closed.
  return NextResponse.redirect(`${base}/commercial?from=${resolved.gone}`, 302);
}
