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

/** Constant-time string compare — edge-safe (no node:crypto, which the edge
 *  middleware can't import). Length is allowed to leak; the value is a single
 *  shared secret, not a per-user token, and network jitter dominates anyway. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when a request carrying this cookie value is an authenticated operator. */
export function isValidOperatorCookie(value: string | undefined): boolean {
  const secret = operatorSecret();
  if (!secret) {
    // FAIL CLOSED in production: a missing OPERATOR_SHARED_SECRET (new env,
    // preview deploy, botched rotation) must NEVER silently make the entire
    // operator area — dashboard, config, send queue, CSV export — public.
    // Mirrors buyer-auth, which throws in production on a missing secret. Dev
    // keeps auth disabled for convenience.
    return process.env.NODE_ENV !== "production";
  }
  return value != null && safeEqual(value, secret);
}
