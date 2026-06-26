import { NextResponse, type NextRequest } from "next/server";
import {
  CUSTOMER_COOKIE,
  CUSTOMER_SESSION_MAX_AGE,
  signToken,
  verifyToken,
} from "@/lib/customer-auth";

// Magic-link landing: validate the short-lived login token, mint a session
// cookie, and redirect into the portal. Route handler (not a page) so it can
// set cookies.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const email = verifyToken(token, "login");
  if (!email) {
    return NextResponse.redirect(new URL("/customer/login?error=1", req.url));
  }
  const res = NextResponse.redirect(new URL("/customer", req.url));
  res.cookies.set(CUSTOMER_COOKIE, signToken(email, "session"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CUSTOMER_SESSION_MAX_AGE,
  });
  return res;
}
