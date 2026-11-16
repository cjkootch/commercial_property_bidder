// Which inbound mail is actually OURS to act on.
//
// Greenkeep shares one Resend account with other businesses, Wild Rose
// Advisors among them. Resend webhooks are account-level: every email received
// on ANY domain in the account is POSTed to greenkeep.us/api/webhooks/resend.
// Before this filter, that meant Wild Rose's own mail was fetched, logged and
// emailed to Greenkeep's operator as a "Reply from ..." alert sent from
// leads@greenkeep.us — on 2026-11-16, a reply from support+zara@micro1.ai to a
// Wild Rose email, and a partner notice addressed to cole@wildroseadvisors.com.
//
// The quieter half of the bug was worse: the bounce and complaint handlers
// added Wild Rose's recipients to GREENKEEP's suppression list, so one
// business's bounces silently taught the other not to email those people.
// Wild Rose handles its own mail in its own app.
//
// Pure and dependency-free on purpose. This decides whether a webhook is acted
// on at all, so it must be testable without a database or an HTTP client — and
// the env var is a PARAMETER with a default, so the tests exercise the real
// parser instead of mutating process.env.

/** Used when INBOUND_ALLOWED_DOMAINS is not set at all. */
export const DEFAULT_INBOUND_DOMAINS = ["greenkeep.us"] as const;

/** The domains whose inbound mail this deployment owns.
 *
 *  UNSET falls back to the default, so an existing deployment keeps working.
 *  SET BUT EMPTY returns [] and fails CLOSED — nothing is ours, so nothing is
 *  acted on. That asymmetry is deliberate: an empty list costs us a missed
 *  alert, while treating an unparseable list as "allow everything" leaks
 *  another business's mail and poisons our suppression list with their
 *  contacts. Only one of those is recoverable. */
export function allowedInboundDomains(
  env: string | undefined = process.env.INBOUND_ALLOWED_DOMAINS
): string[] {
  if (env === undefined) return [...DEFAULT_INBOUND_DOMAINS];
  return env
    .split(",")
    .map((d) => normalizeDomain(d))
    .filter((d): d is string => !!d);
}

/** Lowercase, trimmed, no leading `@`, no trailing dot.
 *
 *  `@greenkeep.us` is how someone naturally writes a domain in a config value.
 *  `greenkeep.us.` is the FQDN spelling of the same domain, and leaving the dot
 *  on would both break a legitimate match and hand someone a trivial way past
 *  the check. */
function normalizeDomain(d: string): string | null {
  const s = d.trim().toLowerCase().replace(/^@+/, "").replace(/\.+$/, "");
  return s || null;
}

/** The domain of an email address, from either `Name <a@b.com>` or a bare
 *  `a@b.com`. Reads the LAST `@` so a quoted local part cannot smuggle one in,
 *  and keeps only characters that can appear in a hostname, so
 *  `a@b.com (comment)` and a stray `>` both read as `b.com`. */
export function domainOf(address: string | null | undefined): string | null {
  if (!address) return null;
  const candidate = (address.match(/<([^>]*)>/)?.[1] ?? address).trim();
  const at = candidate.lastIndexOf("@");
  if (at === -1) return null;
  const host = candidate.slice(at + 1).match(/^[a-z0-9.-]+/i)?.[0];
  return host ? normalizeDomain(host) : null;
}

/** Is this address on one of our domains — exactly, or as a subdomain?
 *
 *  Subdomains count because white-label tenants live on them
 *  (acme.greenkeep.us; see TENANT_ROOT_DOMAIN). The suffix test is anchored on
 *  a dot and the equality test is exact, and that is the whole defence against
 *  a lookalike: `notgreenkeep.us` ends with `greenkeep.us` but not with
 *  `.greenkeep.us`, and `greenkeep.us.evil.com` merely CONTAINS ours. A bare
 *  `endsWith` on the domain would admit both. */
export function isOurDomain(
  address: string | null | undefined,
  allowed: readonly string[] = allowedInboundDomains()
): boolean {
  const domain = domainOf(address);
  if (!domain) return false;
  return allowed.some((a) => {
    const our = normalizeDomain(a);
    return !!our && (domain === our || domain.endsWith(`.${our}`));
  });
}

/** Is ANY recipient ours? A message addressed to both businesses is ours to
 *  handle; better to alert twice than to drop a real reply.
 *
 *  Accepts the shapes the two providers actually send: Resend's `to` is a
 *  string or an array, SES's `mail.destination` is an array. Each entry is also
 *  split on commas, because a raw header can carry several addresses in one
 *  string. Splitting only ever surfaces an address that was already there — it
 *  cannot invent one — so it adds no way past the check. */
export function addressedToUs(
  to: readonly string[] | string | null | undefined,
  allowed: readonly string[] = allowedInboundDomains()
): boolean {
  const entries = Array.isArray(to) ? to : typeof to === "string" ? [to] : [];
  return entries
    .flatMap((e) => (typeof e === "string" ? e.split(",") : []))
    .some((a) => isOurDomain(a, allowed));
}
