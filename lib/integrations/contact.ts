// Free, digital-first contact resolution (no snail mail). Resolves a sendable
// phone/email for a property without paid APIs:
//   1. OSM POI contact tags inside the parcel (phone/email/website/operator).
//   2. If we have a website but no email, scrape the site's home + /contact page
//      for an email and phone.
// Returns a SUGGESTION the operator confirms before any outreach (build spec
// section 9 / no-send-without-approval). Apollo/Hunter remain separate paid
// fallbacks layered on top later.

import type { ParcelResult } from "../geo/types";
import { fetchAllContactTagsInParcel, type OsmContact } from "./osm";

export type ContactSuggestion = {
  name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  /** Where each datum came from, for the operator's trust check. */
  sources: string[];
};

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// Loose US phone matcher (e.g. (281) 555-1234, 281-555-1234, +1 281 555 1234).
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;

const JUNK_EMAIL = /\.(png|jpg|jpeg|gif|webp|svg|css|js)$/i;
// Template/placeholder addresses that ship inside website builders' boilerplate
// (found live: user@domain.com, no@email.com). Sending to these bounces — and
// bounces on a young domain are reputation poison. Treat as "no email found".
const PLACEHOLDER_EMAIL =
  /@(domain|email|example|yourdomain|yoursite|mysite|company|test|sentry|wixpress|placeholder)\.|^(user|no|test|name|someone|your|info@example)@|@.*\.(test|invalid|local)$/i;

function normalizeUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    return new URL(t.startsWith("http") ? t : `https://${t}`).toString();
  } catch {
    return null;
  }
}

async function fetchText(url: string, ms = 8000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GroundsBot/1.0)" },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html") && !ct.includes("text")) return null;
    const buf = await res.text();
    return buf.slice(0, 500_000); // cap to keep parsing cheap
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the first plausible email + phone from a page's HTML. */
function extractFromHtml(html: string): { email: string | null; phone: string | null } {
  // Prefer mailto: links (most reliable), then any inline email.
  const mailto = [...html.matchAll(/mailto:([^"'>?\s]+)/gi)].map((m) => m[1].toLowerCase());
  const inline = (html.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase());
  const email =
    [...mailto, ...inline].find(
      (e) => !JUNK_EMAIL.test(e) && !PLACEHOLDER_EMAIL.test(e) && !e.includes("example.")
    ) ?? null;
  const phone = html.replace(/<[^>]+>/g, " ").match(PHONE_RE)?.[0]?.trim() ?? null;
  return { email, phone };
}

/** Scrape a site's home + common contact paths for an email/phone. */
async function scrapeSite(website: string): Promise<{ email: string | null; phone: string | null }> {
  const base = normalizeUrl(website);
  if (!base) return { email: null, phone: null };
  const origin = new URL(base).origin;
  const urls = [base, `${origin}/contact`, `${origin}/contact-us`, `${origin}/about`];
  let phone: string | null = null;
  for (const u of urls) {
    const html = await fetchText(u);
    if (!html) continue;
    const got = extractFromHtml(html);
    phone = phone ?? got.phone;
    if (got.email) return { email: got.email, phone: phone ?? got.phone };
  }
  return { email: null, phone };
}

export type BusinessContact = {
  email: string | null;
  phone: string | null;
  /** The site's contact/quote page, if one is linked from the homepage —
   *  where a campaign message gets pasted. */
  contact_form_url: string | null;
};

/**
 * Scrape a BUSINESS website (e.g. a prospective lead buyer) for its published
 * email/phone and its contact-page URL. Self-published data only; never throws.
 */
export async function scrapeBusinessContact(website: string): Promise<BusinessContact> {
  const base = normalizeUrl(website);
  if (!base) return { email: null, phone: null, contact_form_url: null };
  const origin = new URL(base).origin;

  let email: string | null = null;
  let phone: string | null = null;
  let contactUrl: string | null = null;

  const home = await fetchText(base);
  if (home) {
    const got = extractFromHtml(home);
    email = got.email;
    phone = got.phone;
    // First homepage link that smells like a contact/quote page.
    for (const m of home.matchAll(/href=["']([^"']+)["']/gi)) {
      const href = m[1];
      if (!/contact|quote|estimate|get-in-touch/i.test(href)) continue;
      if (/facebook|instagram|twitter|linkedin|mailto:|tel:/i.test(href)) continue;
      try {
        contactUrl = new URL(href, origin).toString();
        break;
      } catch {
        /* malformed href */
      }
    }
  }
  // Fill gaps from the contact page (or conventional paths).
  for (const u of [contactUrl, `${origin}/contact`, `${origin}/contact-us`].filter(Boolean) as string[]) {
    if (email && phone && contactUrl) break;
    const html = await fetchText(u);
    if (!html) continue;
    if (!contactUrl) contactUrl = u;
    const got = extractFromHtml(html);
    email = email ?? got.email;
    phone = phone ?? got.phone;
  }
  return { email, phone, contact_form_url: contactUrl };
}

/** Significant lowercase tokens of a name ("Houston First Corp" -> houston,first,corp). */
function tokens(s: string | null | undefined): string[] {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !["the", "and", "inc", "llc", "ltd", "corp", "corporation", "company"].includes(t));
}

/** How many expected-name tokens a candidate's name/operator shares. */
function nameScore(c: OsmContact, expected: string[][]): number {
  const cand = new Set([...tokens(c.name), ...tokens(c.operator)]);
  let best = 0;
  for (const exp of expected) {
    const hits = exp.filter((t) => cand.has(t)).length;
    if (hits > best) best = hits;
  }
  return best;
}

/**
 * Resolve a free contact suggestion for a property from its parcel: OSM contact
 * tags scored against the EXPECTED names (facility, owner of record) so a
 * tenant business inside the parcel (a kiosk in a convention center) can't
 * masquerade as the decision-maker. Site scrape fills gaps only for a
 * name-matched candidate. Never throws; null when nothing usable.
 */
export async function findContact(
  parcel: ParcelResult | null,
  expectedNames: (string | null | undefined)[] = []
): Promise<ContactSuggestion | null> {
  if (!parcel) return null;
  const candidates = await fetchAllContactTagsInParcel(parcel);
  if (!candidates.length) return null;

  const expected = [...expectedNames, parcel.owner]
    .map((n) => tokens(n))
    .filter((t) => t.length > 0);

  let osm: OsmContact | null = null;
  let matched = false;
  if (expected.length) {
    const scored = candidates
      .map((c) => ({ c, score: nameScore(c, expected) }))
      .sort((a, b) => b.score - a.score);
    if (scored[0].score > 0) {
      osm = scored[0].c;
      matched = true;
    } else {
      // Nothing matches the owner/facility — every candidate is some other
      // business on the parcel. Suggest the most contactable one, clearly
      // labeled unverified, and DON'T scrape its site (a Starbucks email is
      // worse than none).
      osm = candidates.find((c) => c.phone || c.email || c.website) ?? candidates[0];
    }
  } else {
    osm = candidates.find((c) => c.phone || c.email || c.website) ?? candidates[0];
    matched = true; // nothing to check against — legacy behavior
  }

  const sources: string[] = [];
  const name = osm?.name ?? osm?.operator ?? null;
  let phone = osm?.phone ?? null;
  let email = osm?.email ?? null;
  const website = osm?.website ?? null;
  if (osm && (osm.phone || osm.email || osm.website)) {
    sources.push(matched ? "osm" : "osm (unverified on-site business)");
  }

  // Fill gaps from the website — only when the candidate matched the expected
  // owner/facility name.
  if (matched && website && (!email || !phone)) {
    const scraped = await scrapeSite(website);
    if (scraped.email && !email) {
      email = scraped.email;
      sources.push("website");
    }
    if (scraped.phone && !phone) {
      phone = scraped.phone;
      if (!sources.includes("website")) sources.push("website");
    }
  }

  if (!name && !phone && !email && !website) return null;
  if (!matched && expected.length) {
    // Unverified tenant: name + phone only (a human can vet); never its
    // email/website — those actively mislead on a sold sheet.
    return { name, phone, email: null, website: null, sources };
  }
  return { name, phone, email, website, sources };
}
