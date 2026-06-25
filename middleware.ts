import { NextResponse, type NextRequest } from "next/server";
import { OPERATOR_COOKIE, isValidOperatorCookie } from "./lib/auth";

// Protects operator routes behind the shared-secret cookie. Public proposal
// pages (/proposals/*), the login page, the unsubscribe endpoint, and webhooks
// stay open. See lib/auth.ts (TODO: swap for Clerk).
const PUBLIC_PREFIXES = [
  "/login",
  "/proposals",
  "/api/unsubscribe",
  "/api/webhooks",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(OPERATOR_COOKIE)?.value;
  if (isValidOperatorCookie(cookie)) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
