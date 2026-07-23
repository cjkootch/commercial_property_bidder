// Passwordless BUYER auth (lead-marketplace side), mirroring lib/customer-auth:
// signed HMAC tokens, no passwords. Four token kinds:
//   - claim:   embedded in campaign teasers; carries the free lead's property_id
//              (+ suggested company name). Opening it IS the invitation.
//   - login:   short-TTL magic link for returning buyers.
//   - session: long-TTL, stored in the gk_buyer cookie (carries buyer id).
//   - unsub:   one-click unsubscribe in alert emails (no login required).

import crypto from "node:crypto";

export const BUYER_COOKIE = "gk_buyer";
const CLAIM_TTL = 30 * 24 * 60 * 60; // 30 days — teasers sit in inboxes
const LOGIN_TTL = 30 * 60;
const SESSION_TTL = 30 * 24 * 60 * 60;
export const BUYER_SESSION_MAX_AGE = SESSION_TTL;

function secret(): string {
  const s =
    process.env.BUYER_AUTH_SECRET ||
    process.env.CUSTOMER_AUTH_SECRET ||
    process.env.OPERATOR_SHARED_SECRET;
  if (s) return s;
  // Fail loudly in production — a hardcoded fallback would make every buyer
  // session and claim link forgeable.
  if (process.env.NODE_ENV === "production") {
    throw new Error("BUYER_AUTH_SECRET (or CUSTOMER_AUTH_SECRET/OPERATOR_SHARED_SECRET) must be set.");
  }
  return "dev-insecure-buyer-secret";
}

type Payload =
  | { kind: "claim"; property_id: string; company: string | null; exp: number }
  | { kind: "login"; email: string; exp: number }
  | { kind: "session"; buyer_id: string; exp: number }
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

export function signBuyerClaim(propertyId: string, company: string | null): string {
  return sign({ kind: "claim", property_id: propertyId, company, exp: nowSec() + CLAIM_TTL });
}
export function verifyBuyerClaim(token: string | null | undefined): { property_id: string; company: string | null } | null {
  const p = verify(token);
  return p?.kind === "claim" ? { property_id: p.property_id, company: p.company } : null;
}

// --- phone-only buyers ------------------------------------------------------
// buyer.email is NOT NULL UNIQUE, but the SMS channel deliberately targets
// companies with no email — the exact people who hit an email wall on the
// claim form. Phone-only signups store a DETERMINISTIC internal placeholder
// (same phone → same address → same buyer row on re-claim). It is never a
// real mailbox: sendEmail() refuses the domain centrally, and sign-in happens
// via SMS magic link instead.
export const PLACEHOLDER_EMAIL_DOMAIN = "members.greenkeep.us";
export function phonePlaceholderEmail(phoneE164: string): string {
  return `p${phoneE164.replace(/\D/g, "")}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}

export function signBuyerLogin(email: string, ttlSec: number = LOGIN_TTL): string {
  // Default 30min (interactive magic links). Guest purchase-delivery emails
  // pass a longer TTL — the report link must survive being opened tonight or
  // next week; email possession IS the auth model of a passwordless product.
  return sign({ kind: "login", email: email.toLowerCase().trim(), exp: nowSec() + ttlSec });
}
export function verifyBuyerLogin(token: string | null | undefined): string | null {
  const p = verify(token);
  return p?.kind === "login" ? p.email : null;
}

export function signBuyerSession(buyerId: string): string {
  return sign({ kind: "session", buyer_id: buyerId, exp: nowSec() + SESSION_TTL });
}
export function verifyBuyerSession(token: string | null | undefined): string | null {
  const p = verify(token);
  return p?.kind === "session" ? p.buyer_id : null;
}

// One-click unsubscribe links for alert emails (opting out must not require a
// login). Effectively non-expiring.
const UNSUB_TTL = 10 * 365 * 24 * 60 * 60;
export function signBuyerUnsub(email: string): string {
  return sign({ kind: "unsub", email: email.toLowerCase().trim(), exp: nowSec() + UNSUB_TTL });
}
export function verifyBuyerUnsub(token: string | null | undefined): string | null {
  const p = verify(token);
  return p?.kind === "unsub" ? p.email : null;
}
