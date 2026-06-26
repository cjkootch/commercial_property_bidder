import { NextResponse, type NextRequest } from "next/server";
import { OPERATOR_COOKIE, isValidOperatorCookie } from "./lib/auth";

// Three zones:
//  - PUBLIC: marketing home (/), proposal pages, both login flows, webhooks.
//  - CUSTOMER (/customer/*): requires a customer session cookie (verified
//    cryptographically in the page; here we only check presence).
//  - OPERATOR (everything else: /dashboard, /properties, /config): shared
//    secret cookie. Cookie name is hardcoded to avoid importing node:crypto
//    (lib/customer-auth) into the edge middleware.
const CUSTOMER_COOKIE = "gk_customer";
const PUBLIC_PREFIXES = [
  "/login",
  "/residential",
  "/commercial",
  "/quote",
  "/proposals",
  "/customer/login",
  "/customer/verify",
  "/api/unsubscribe",
  "/api/webhooks",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Customer portal — require a customer session cookie (presence check).
  if (pathname.startsWith("/customer")) {
    if (req.cookies.get(CUSTOMER_COOKIE)?.value) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = "/customer/login";
    return NextResponse.redirect(url);
  }

  // Operator area.
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
