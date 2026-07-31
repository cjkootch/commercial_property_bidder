// Short links for SMS.
//
// A claim URL is a signed JWT — stateless, unforgeable, and ~400 characters.
// In a text message that wraps to eight lines of opaque base64 and reads like
// phishing at precisely the moment a stranger is deciding whether we are real.
// A prospect on 2026-07-30 opened one and immediately asked where our office
// was; the link is doing us no favours.
//
// This wraps the URL, it does not replace the token. The redirect target is the
// same signed URL with the same expiry; the code is only an envelope. Which
// means the code is a BEARER credential and is generated accordingly.
//
// EVERYTHING HERE FAILS SOFT. A shortener that throws must never cost a send —
// the long URL works perfectly well, it is just ugly. Every entry point returns
// the original text when anything goes wrong.

import crypto from "node:crypto";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { shortLink } from "@/lib/db/schema";

/** No look-alike characters (0/O, 1/l/I): these get read aloud over the phone
 *  and typed by hand more often than you would think. */
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 9;

/** PURE-ish (crypto random): an unguessable code. 56^9 ≈ 5.6e15 — brute forcing
 *  is not a threat at any rate an HTTP endpoint can be driven. Rejection
 *  sampling keeps the distribution uniform; a naive % would bias early letters. */
export function generateCode(len = CODE_LEN): string {
  const out: string[] = [];
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < len) {
    for (const b of crypto.randomBytes(len * 2)) {
      if (b >= limit) continue; // discard, don't fold — folding biases
      out.push(ALPHABET[b % ALPHABET.length]);
      if (out.length === len) break;
    }
  }
  return out.join("");
}

function siteBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://greenkeep.us").replace(/\/$/, "");
}

/** PURE. Every claim URL in a block of text. Deliberately narrow — it matches
 *  only our own claim links, so nothing else in a message can be rewritten. */
export function findClaimUrls(text: string): string[] {
  const re = /https?:\/\/[^\s]*\/buyers\/claim\/[^\s]+/g;
  return [...new Set(text.match(re) ?? [])];
}

/** PURE. Expiry encoded in a claim token's payload, or null if unreadable.
 *  The short link must not outlive the token — handing someone a link that
 *  lands on "expired" is worse than handing them a long one that works. */
export function claimTokenExpiry(url: string): Date | null {
  try {
    const token = url.split("/buyers/claim/")[1]?.split("?")[0];
    const payload = token?.split(".")[0];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json.exp === "number" ? new Date(json.exp * 1000) : null;
  } catch {
    return null;
  }
}

/** Mint a short link. Returns null on any failure — callers keep the original. */
export async function shortenUrl(
  target: string,
  opts?: { expiresAt?: Date | null; source?: string }
): Promise<string | null> {
  try {
    // Retry on the astronomically unlikely code collision rather than throwing.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateCode();
      const [row] = await db
        .insert(shortLink)
        .values({
          code,
          target_url: target,
          expires_at: opts?.expiresAt ?? null,
          source: opts?.source ?? "sms",
        })
        .onConflictDoNothing({ target: shortLink.code })
        .returning({ code: shortLink.code });
      if (row) return `${siteBase()}/l/${row.code}`;
    }
    return null;
  } catch (e) {
    console.error("shortenUrl failed:", e);
    return null;
  }
}

/**
 * Replace every claim URL in an SMS body with a short one.
 *
 * Failure is per-URL and silent: a link that can't be shortened stays long, so
 * the worst case is the message we would have sent anyway. This is the whole
 * safety argument for putting the call inside sendSms.
 */
export async function shortenClaimLinksIn(body: string): Promise<string> {
  const urls = findClaimUrls(body);
  if (!urls.length) return body;
  let out = body;
  for (const url of urls) {
    const short = await shortenUrl(url, { expiresAt: claimTokenExpiry(url), source: "sms" });
    if (short) out = out.split(url).join(short);
  }
  return out;
}

export type ResolvedLink = { target: string } | { gone: "expired" | "missing" };

/** Resolve a code and count the click. Expired links report `expired` so the
 *  route can say so instead of 404-ing someone who was legitimately sent it. */
export async function resolveShortLink(code: string): Promise<ResolvedLink> {
  const rows = await db
    .select({ target: shortLink.target_url, expires: shortLink.expires_at })
    .from(shortLink)
    .where(eq(shortLink.code, code))
    .limit(1);
  const row = rows[0];
  if (!row) return { gone: "missing" };
  if (row.expires && row.expires.getTime() < Date.now()) return { gone: "expired" };

  // Best-effort: a failed counter must never block the redirect. The click is
  // interesting; the prospect reaching the page is the point.
  await db
    .update(shortLink)
    .set({ click_count: sql`${shortLink.click_count} + 1`, last_clicked_at: new Date() })
    .where(eq(shortLink.code, code))
    .catch((e) => console.error("short link click count failed:", e));

  return { target: row.target };
}

/** Housekeeping: drop links whose token expired more than `days` ago. The row
 *  is worthless once the target 410s, and this table grows per send. */
export async function pruneExpiredShortLinks(days = 30): Promise<void> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  await db
    .delete(shortLink)
    .where(and(sql`${shortLink.expires_at} is not null`, sql`${shortLink.expires_at} < ${cutoff}`))
    .catch((e) => console.error("pruneExpiredShortLinks failed:", e));
}
