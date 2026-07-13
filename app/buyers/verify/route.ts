import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer } from "@/lib/db/schema";
import {
  BUYER_COOKIE,
  BUYER_SESSION_MAX_AGE,
  signBuyerSession,
  verifyBuyerLogin,
} from "@/lib/buyer-auth";

// Buyer magic-link landing: validate the short-lived login token, mint a
// session cookie, redirect into the dashboard.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const email = verifyBuyerLogin(req.nextUrl.searchParams.get("token"));
  const [row] = email
    ? await db.select().from(buyer).where(eq(buyer.email, email)).limit(1)
    : [undefined];
  if (!row || row.banned_at) {
    // Distinguish a dead token from a valid token whose account is gone —
    // "expired" would send them into a loop of fresh links that keep failing.
    // A banned account is refused at login too (not just per-action).
    const q = email ? "error=1" : "expired=1";
    return NextResponse.redirect(new URL(`/buyers/login?${q}`, req.url));
  }
  const res = NextResponse.redirect(new URL("/buyers", req.url));
  res.cookies.set(BUYER_COOKIE, signBuyerSession(row.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: BUYER_SESSION_MAX_AGE,
  });
  return res;
}
