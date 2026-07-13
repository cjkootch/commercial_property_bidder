// Passwordless customer auth via signed magic-link tokens (no DB table, no
// passwords). A token is `base64url(payload).signature`, HMAC-SHA256 over the
// payload with a server secret. Two uses:
//   - login token (short TTL) emailed as a magic link
//   - session token (long TTL) stored in the customer cookie
//
// Operator auth (lib/auth.ts) is separate; this gates only the /customer area.

import crypto from "node:crypto";

export const CUSTOMER_COOKIE = "gk_customer";
const LOGIN_TTL = 30 * 60; // 30 min
const SESSION_TTL = 30 * 24 * 60 * 60; // 30 days

function secret(): string {
  const s = process.env.CUSTOMER_AUTH_SECRET || process.env.OPERATOR_SHARED_SECRET;
  if (s) return s;
  // Fail loudly in production — the old hardcoded fallback is committed to the
  // repo, so anyone who read the code could forge a session token for ANY
  // customer email and walk into the portal. Mirrors buyer-auth. (The
  // OPERATOR_SHARED_SECRET fallback is a known privilege-linkage — see
  // docs/security-followups.md; removing it needs a paired Vercel env step.)
  if (process.env.NODE_ENV === "production") {
    throw new Error("CUSTOMER_AUTH_SECRET (or OPERATOR_SHARED_SECRET) must be set.");
  }
  return "dev-insecure-customer-secret";
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

type Payload = { email: string; kind: "login" | "session"; exp: number };

export function signToken(email: string, kind: "login" | "session"): string {
  const ttl = kind === "login" ? LOGIN_TTL : SESSION_TTL;
  // exp is passed in by callers that have a clock; here we accept that this runs
  // server-side where Date is available.
  const payload: Payload = { email: email.toLowerCase().trim(), kind, exp: nowSec() + ttl };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token: string | undefined | null, kind: "login" | "session"): string | null {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload.kind !== kind) return null;
  if (typeof payload.exp !== "number" || payload.exp < nowSec()) return null;
  return payload.email;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export const CUSTOMER_SESSION_MAX_AGE = SESSION_TTL;
