// Server-side session resolution: cookie → crm_user row.
//
// The source app had no equivalent — its whole operator area was one shared
// secret with no notion of "who". This is the piece that makes per-user
// ownership, revisit queues, and the audit log meaningful.
//
// Every sensitive page/action calls requireUser(). The edge middleware only
// checks that a cookie EXISTS (it cannot import node:crypto), so this is where
// the signature is actually verified — the same split the source app used, and
// the reason its middleware was safe despite doing a presence check.

import { cookies } from "next/headers";
import { eq, isNull, and } from "drizzle-orm";
import { db } from "../db";
import { crmUser, type CrmUser } from "../db/schema";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from "./tokens";

/** Current user, or null. Verifies the HMAC AND that the account is still
 *  enabled — disabling a user must lock them out before their token expires. */
export async function currentUser(): Promise<CrmUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const userId = verifySession(token);
  if (!userId) return null;
  const [row] = await db
    .select()
    .from(crmUser)
    .where(and(eq(crmUser.id, userId), isNull(crmUser.disabled_at)))
    .limit(1);
  return row ?? null;
}

/** Throwing variant for server actions and route handlers. */
export async function requireUser(): Promise<CrmUser> {
  const u = await currentUser();
  if (!u) throw new Error("Not authenticated");
  return u;
}

export async function requireAdmin(): Promise<CrmUser> {
  const u = await requireUser();
  if (u.role !== "admin") throw new Error("Admin only");
  return u;
}

/** Cookie options used by both the sign-in route and sign-out. */
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE,
};

/** Mint the cookie value for a verified user. The caller sets it on its own
 *  Response (a server action cannot always set cookies directly). */
export function sessionCookieValue(userId: string): string {
  return signSession(userId);
}

export { SESSION_COOKIE };
