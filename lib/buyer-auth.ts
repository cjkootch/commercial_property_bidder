// Passwordless BUYER auth (lead-marketplace side), mirroring lib/customer-auth:
// signed HMAC tokens, no passwords. Three token kinds:
//   - claim:   embedded in campaign teasers; carries the free lead's property_id
//              (+ suggested company name). Opening it IS the invitation.
//   - login:   short-TTL magic link for returning buyers.
//   - session: long-TTL, stored in the gk_buyer cookie (carries buyer id).

import crypto from "node:crypto";

export const BUYER_COOKIE = "gk_buyer";
const CLAIM_TTL = 30 * 24 * 60 * 60; // 30 days — teasers sit in inboxes
const LOGIN_TTL = 30 * 60;
const SESSION_TTL = 30 * 24 * 60 * 60;
export const BUYER_SESSION_MAX_AGE = SESSION_TTL;

function secret(): string {
  return (
    process.env.BUYER_AUTH_SECRET ||
    process.env.CUSTOMER_AUTH_SECRET ||
    process.env.OPERATOR_SHARED_SECRET ||
    "dev-insecure-buyer-secret"
  );
}

type Payload =
  | { kind: "claim"; property_id: string; company: string | null; exp: number }
  | { kind: "login"; email: string; exp: number }
  | { kind: "session"; buyer_id: string; exp: number };

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

export function signBuyerLogin(email: string): string {
  return sign({ kind: "login", email: email.toLowerCase().trim(), exp: nowSec() + LOGIN_TTL });
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
