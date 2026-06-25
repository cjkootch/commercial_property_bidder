// Lightweight operator auth (build spec section 3 fallback). Clerk is the
// intended auth; until it's wired, operator routes are gated behind a single
// shared secret (OPERATOR_SHARED_SECRET) stored in an httpOnly cookie.
//
// TODO(clerk): replace this module + middleware.ts with Clerk's
// authMiddleware and remove the shared-secret login flow.

export const OPERATOR_COOKIE = "op_session";

/** The configured operator secret, or null if auth is disabled (dev). */
export function operatorSecret(): string | null {
  const s = process.env.OPERATOR_SHARED_SECRET;
  return s && s.length > 0 ? s : null;
}

/** True when a request carrying this cookie value is an authenticated operator. */
export function isValidOperatorCookie(value: string | undefined): boolean {
  const secret = operatorSecret();
  // No secret configured -> auth disabled, everything is allowed.
  if (!secret) return true;
  return value === secret;
}
