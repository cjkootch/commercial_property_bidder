// Passwordless auth: stateless HMAC-signed tokens. Ported from
// lib/buyer-auth.ts, narrowed from four token kinds to two (login, session) plus
// unsubscribe, and repointed at crm_user.
//
// Why this and not Clerk/Auth.js: there is no password to leak, no session table
// to query on every request, and no vendor in the login path. For a firm of a
// handful of bankers on a private CRM it is the right amount of machinery. The
// trade-off is honest: a session token cannot be revoked before it expires
// (see PACKET.md → rough edges) — mitigate by keeping SESSION_TTL modest and
// checking crm_user.disabled_at on each request in requireUser().
//
// Node runtime only (node:crypto). Edge middleware must NOT import this — it
// checks cookie PRESENCE only; real verification happens in the route/page.

import crypto from "node:crypto";

export const SESSION_COOKIE = "crm_session";

const LOGIN_TTL = 30 * 60; // 30min magic link
const SESSION_TTL = 12 * 60 * 60; // 12h working session
const UNSUB_TTL = 10 * 365 * 24 * 60 * 60;

export const SESSION_MAX_AGE = SESSION_TTL;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  // Fail loudly in production: a hardcoded fallback would make every session
  // forgeable by anyone who read the repo.
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set.");
  }
  return "dev-insecure-secret";
}

type Payload =
  | { kind: "login"; email: string; exp: number }
  | { kind: "session"; user_id: string; exp: number }
  | { kind: "unsub"; email: string; exp: number };

function sign(payload: Payload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token: string | undefined | null): Payload | null {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  // Length check first: timingSafeEqual throws on a length mismatch.
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
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

const nowSec = () => Math.floor(Date.now() / 1000);

/** Magic sign-in link token. `ttlSec` is overridable: an emailed "open this
 *  record" link for a colleague wants days, an interactive login wants minutes. */
export function signLogin(email: string, ttlSec: number = LOGIN_TTL): string {
  return sign({ kind: "login", email: email.toLowerCase().trim(), exp: nowSec() + ttlSec });
}
export function verifyLogin(token: string | null | undefined): string | null {
  const p = verify(token);
  return p?.kind === "login" ? p.email : null;
}

export function signSession(userId: string): string {
  return sign({ kind: "session", user_id: userId, exp: nowSec() + SESSION_TTL });
}
export function verifySession(token: string | null | undefined): string | null {
  const p = verify(token);
  return p?.kind === "session" ? p.user_id : null;
}

/** One-click unsubscribe token — opting out must never require a login. */
export function signUnsub(email: string): string {
  return sign({ kind: "unsub", email: email.toLowerCase().trim(), exp: nowSec() + UNSUB_TTL });
}
export function verifyUnsub(token: string | null | undefined): string | null {
  const p = verify(token);
  return p?.kind === "unsub" ? p.email : null;
}
