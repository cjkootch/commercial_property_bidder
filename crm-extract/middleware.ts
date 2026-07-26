// Edge auth gate. Ported from the source app's middleware.ts, reduced from three
// audiences (buyer/customer/operator) to one (staff), keeping the two details
// that were load-bearing:
//
//  1. SEGMENT-BOUNDARY public matching. A bare startsWith("/api/webhooks") also
//     publicizes "/api/webhooks-admin". `isPublic` requires an exact match or a
//     "/" boundary, so a future private route can never be silently exposed by
//     sharing a prefix with a public one.
//
//  2. PRESENCE-ONLY cookie check. This runs on the edge runtime, which cannot
//     import node:crypto, so it must not pretend to verify the signature. The
//     real check is auth/session.ts requireUser(), called by every page and
//     action. Middleware here is a redirect convenience, not the security
//     boundary — stated plainly so nobody later "optimizes away" the server-side
//     check believing middleware covered it.
//
// Place at the project root as middleware.ts.

import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "crm_session"; // must match auth/tokens.ts

const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth", // magic-link request + verify
  "/api/webhooks", // signature-verified inside (Resend, mail vendor)
  "/api/cron", // CRON_SECRET-verified inside
  "/api/unsubscribe", // one-click opt-out must not require a login
  "/robots.txt",
  "/favicon.ico",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  if (req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  // Preserve the destination so sign-in lands where they were headed.
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
