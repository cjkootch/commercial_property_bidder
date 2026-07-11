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
const BUYER_COOKIE = "gk_buyer";
const PUBLIC_PREFIXES = [
  "/brand", // static logo assets — emails, claim pages, and login screens embed them
  "/hero.webp",
  "/api/area-map", // buyer profile coverage map (staticmap proxy, no private data)
  "/login",
  "/terms",
  "/privacy",
  "/why",
  "/about", // diligence pages — a login wall here reads as fly-by-night
  "/contact",
  "/residential",
  "/commercial",
  "/bids", // owner-side bid requests (public form)
  "/quote",
  "/proposals",
  "/customer/login",
  "/customer/verify",
  "/buyers/claim", // campaign claim links (token-authenticated)
  "/buyers/signup",
  "/buyers/login",
  "/buyers/verify",
  "/api/unsubscribe",
  "/api/webhooks",
  "/api/property-preview",
  "/api/postcard-asset", // Lob fetches the prospect aerial by unguessable slug
  "/api/cron", // routes self-authenticate with CRON_SECRET
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Buyer portal (lead marketplace) — require a buyer session cookie.
  if (pathname === "/buyers" || pathname.startsWith("/buyers/")) {
    if (req.cookies.get(BUYER_COOKIE)?.value) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = "/buyers/login";
    return NextResponse.redirect(url);
  }

  // Customer portal — require a customer session cookie (presence check).
  // Segment-exact so the operator /customers roster doesn't match.
  if (pathname === "/customer" || pathname.startsWith("/customer/")) {
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
