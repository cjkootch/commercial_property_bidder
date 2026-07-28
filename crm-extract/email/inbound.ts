// Inbound email → timeline.
//
// Replies are the conversion event of an origination program, so this path has
// one job: never lose one. The MIME parser is ported verbatim from
// lib/email/inbound.ts (it has real unit tests in the source app and handles the
// cases that actually break naive parsers: nested multipart, quoted-printable
// multibyte sequences, RFC-2047 encoded-word headers, html-only replies).
//
// Best-effort by design: a reply we can only partially parse still beats a reply
// nobody sees.

import { eq, or, sql } from "drizzle-orm";
import { db } from "../db";
import { activity, company, contact } from "../db/schema";

export type InboundEmail = {
  from: string | null;
  fromEmail: string | null;
  subject: string | null;
  /** Plain-text body (or a readable fallback), truncated. */
  text: string;
};

const MAX_BODY = 4000;

/** Unfold headers, find one by name (case-insensitive). */
function header(rawHeaders: string, name: string): string | null {
  const unfolded = rawHeaders.replace(/\r?\n[ \t]+/g, " ");
  const m = unfolded.match(new RegExp(`^${name}:[ \\t]*(.+)$`, "im"));
  return m ? m[1].trim() : null;
}

/** RFC 2047 encoded-words (=?utf-8?B?...?= / =?utf-8?Q?...?=) → text. */
function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, _cs, enc, data) => {
    try {
      if (String(enc).toLowerCase() === "b") return Buffer.from(data, "base64").toString("utf8");
      return decodeQp(String(data).replace(/_/g, " "));
    } catch {
      return data;
    }
  });
}

/** Quoted-printable → text. Soft breaks removed; consecutive =XX bytes are
 *  decoded as ONE buffer so multibyte UTF-8 sequences (=E2=80=99) survive. */
function decodeQp(s: string): string {
  return s.replace(/=\r?\n/g, "").replace(/(?:=[0-9A-F]{2})+/gi, (run) => {
    try {
      return Buffer.from(run.replace(/=/g, ""), "hex").toString("utf8");
    } catch {
      return run;
    }
  });
}

function decodeBody(body: string, encoding: string | null): string {
  const enc = (encoding ?? "").toLowerCase();
  if (enc.includes("base64")) {
    try {
      return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
    } catch {
      return body;
    }
  }
  if (enc.includes("quoted-printable")) return decodeQp(body);
  return body;
}

/** Pull the first text/plain part out of a (possibly nested) multipart body;
 *  falls back to a crudely de-tagged text/html part, then the raw body. */
function extractText(rawHeaders: string, body: string): string {
  const ct = header(rawHeaders, "Content-Type") ?? "";
  const boundary = ct.match(/boundary="?([^";]+)"?/i)?.[1];
  if (!boundary) {
    const decoded = decodeBody(body, header(rawHeaders, "Content-Transfer-Encoding"));
    return /text\/html/i.test(ct) ? decoded.replace(/<[^>]+>/g, " ") : decoded;
  }
  const parts = body.split(
    new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?`)
  );
  let html: string | null = null;
  for (const part of parts) {
    const sep = part.search(/\r?\n\r?\n/);
    if (sep === -1) continue;
    const ph = part.slice(0, sep);
    const pb = part.slice(sep).trim();
    const pct = header(ph, "Content-Type") ?? "";
    if (/multipart\//i.test(pct)) {
      const inner = extractText(ph, pb);
      if (inner.trim()) return inner;
    }
    if (/text\/plain/i.test(pct)) return decodeBody(pb, header(ph, "Content-Transfer-Encoding"));
    if (/text\/html/i.test(pct) && html === null)
      html = decodeBody(pb, header(ph, "Content-Transfer-Encoding")).replace(/<[^>]+>/g, " ");
  }
  return html ?? body;
}

/** Parse a raw RFC-822 message into the fields the timeline needs. */
export function parseInboundEmail(raw: string): InboundEmail {
  const sep = raw.search(/\r?\n\r?\n/);
  const rawHeaders = sep === -1 ? raw : raw.slice(0, sep);
  const body = sep === -1 ? "" : raw.slice(sep);
  const fromRaw = header(rawHeaders, "From");
  const from = fromRaw ? decodeWords(fromRaw) : null;
  const fromEmail =
    fromRaw?.match(/<([^>]+)>/)?.[1]?.toLowerCase() ??
    fromRaw?.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() ??
    null;
  const subjectRaw = header(rawHeaders, "Subject");
  const text = extractText(rawHeaders, body).replace(/\r\n/g, "\n").trim().slice(0, MAX_BODY);
  return { from, fromEmail, subject: subjectRaw ? decodeWords(subjectRaw) : null, text };
}

/** Registrable-ish domain from an email address. Free-mail domains are excluded
 *  as a match axis: matching on "gmail.com" would attach a reply to a random
 *  company. */
const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "msn.com",
  "comcast.net",
  "sbcglobal.net",
]);

export function domainOfEmail(email: string | null | undefined): string | null {
  const d = email?.split("@")[1]?.toLowerCase().trim();
  if (!d || FREE_MAIL.has(d)) return null;
  return d;
}

export type InboundMatch = {
  companyId: string;
  companyName: string;
  contactId: string | null;
};

/**
 * Match a sender to the CRM, most-specific first:
 *   1. a contact row with that exact email  (gives company AND person)
 *   2. a company row with that exact email
 *   3. a company whose domain matches the sender's (non-free-mail) domain
 * Returns null rather than guessing — an unmatched reply is alerted with a
 * "search the CRM" link, which is better than filing it on the wrong record.
 */
export async function matchInboundSender(fromEmail: string | null): Promise<InboundMatch | null> {
  if (!fromEmail) return null;
  const addr = fromEmail.toLowerCase();

  const byContact = await db
    .select({ companyId: company.id, companyName: company.name, contactId: contact.id })
    .from(contact)
    .innerJoin(company, eq(contact.company_id, company.id))
    .where(sql`lower(${contact.email}) = ${addr}`)
    .limit(1);
  if (byContact.length) return byContact[0];

  const byCompanyEmail = await db
    .select({ companyId: company.id, companyName: company.name })
    .from(company)
    .where(sql`lower(${company.email}) = ${addr}`)
    .limit(1);
  if (byCompanyEmail.length) return { ...byCompanyEmail[0], contactId: null };

  const domain = domainOfEmail(addr);
  if (domain) {
    const byDomain = await db
      .select({ companyId: company.id, companyName: company.name })
      .from(company)
      .where(
        or(
          sql`lower(${company.domain}) = ${domain}`,
          sql`lower(${company.website}) like ${"%" + domain + "%"}`
        )
      )
      .limit(1);
    if (byDomain.length) return { ...byDomain[0], contactId: null };
  }
  return null;
}

/**
 * Write an inbound reply onto the company's timeline. `externalId` (the
 * provider's message id) makes this idempotent-ish: pass it and re-delivery of
 * the same webhook won't duplicate the row.
 */
export async function recordInboundReply(o: {
  match: InboundMatch;
  parsed: InboundEmail;
  externalId?: string | null;
  occurredAt?: Date;
}): Promise<void> {
  if (o.externalId) {
    const existing = await db
      .select({ id: activity.id })
      .from(activity)
      .where(eq(activity.external_id, o.externalId))
      .limit(1);
    if (existing.length) return;
  }
  await db.insert(activity).values({
    company_id: o.match.companyId,
    contact_id: o.match.contactId,
    kind: "email_in",
    subject: o.parsed.subject,
    body: o.parsed.text,
    email_address: o.parsed.fromEmail,
    external_id: o.externalId ?? null,
    occurred_at: o.occurredAt ?? new Date(),
  });
}

/** Companies that have replied but have no revisit scheduled — the "warm and
 *  unscheduled" leak. Handy as an ops query / dashboard tile. */
export async function repliedWithoutRevisit(limit = 50) {
  return db
    .selectDistinct({ id: company.id, name: company.name })
    .from(activity)
    .innerJoin(company, eq(activity.company_id, company.id))
    .where(sql`${activity.kind} = 'email_in' and ${company.revisit_date} is null and ${company.blocked_at} is null`)
    .limit(limit);
}
