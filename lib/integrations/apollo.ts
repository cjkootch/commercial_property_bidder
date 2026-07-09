// Apollo company enrichment (REST). The deployed app cannot call MCP tools, so
// this hits Apollo's REST API directly with the server-side API key.
//
// Used to turn a raw parcel owner-of-record name (often an LLC) into a canonical
// company — name, domain, industry, size — that seeds the operator's owner_org
// suggestion and the later contact-enrichment step. NEVER auto-applies to
// owner_org (build spec section 9): the result is a suggestion the operator
// confirms.

export type OwnerSuggestion = {
  /** The raw owner-of-record name we searched with (from county GIS). */
  raw_owner: string;
  /** Canonical company name from Apollo (falls back to raw_owner). */
  name: string;
  domain: string | null;
  website: string | null;
  /** Printed revenue, e.g. "3.4B" (Apollo's organization_revenue_printed). */
  revenue: string | null;
  linkedin: string | null;
  apollo_id: string | null;
  /** "apollo" when enriched, "parcel" when we only have the owner-of-record. */
  source: "apollo" | "parcel";
};

/** Server-side Apollo key. Supports either env name; null disables enrichment. */
export function getApolloKey(): string | null {
  return process.env.APOLLO_API_KEY ?? process.env.APOLLO_API ?? null;
}

/** Free, no-credit suggestion from just the county owner-of-record name. */
export function parcelSuggestion(ownerName: string): OwnerSuggestion {
  return {
    raw_owner: ownerName,
    name: ownerName,
    domain: null,
    website: null,
    revenue: null,
    linkedin: null,
    apollo_id: null,
    source: "parcel",
  };
}

type ApolloOrg = {
  id?: string;
  name?: string;
  primary_domain?: string;
  website_url?: string;
  linkedin_url?: string;
  organization_revenue_printed?: string;
};

/**
 * Search Apollo for the company that best matches `ownerName` and return a
 * canonical OwnerSuggestion. Falls back to a `source: "parcel"` suggestion
 * (just the raw name) when there's no API key or no match — so the operator
 * always gets at least the owner-of-record to confirm. Never throws.
 */
export type BuyerCandidate = {
  name: string;
  website: string | null;
  city: string | null;
  state: string | null;
};

/**
 * Discover prospective LEAD BUYERS (landscaping companies) in a metro via
 * Apollo company search. Used only for OUR OWN outreach targeting — Apollo data
 * never ships inside a sold lead. Returns [] without a key or on error.
 */
export async function searchLandscapers(
  location = "Houston, Texas",
  perPage = 25,
  keywords: string[] = ["landscaping", "lawn care", "grounds maintenance"]
): Promise<BuyerCandidate[]> {
  const key = getApolloKey();
  if (!key) return [];
  try {
    const res = await fetch("https://api.apollo.io/api/v1/mixed_companies/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": key },
      body: JSON.stringify({
        q_organization_keyword_tags: keywords,
        organization_locations: [location],
        page: 1,
        per_page: perPage,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { organizations?: ApolloOrg[]; accounts?: ApolloOrg[] };
    const orgs = [...(data.organizations ?? []), ...(data.accounts ?? [])];
    return orgs
      .filter((o) => o.name?.trim())
      .map((o) => ({
        name: o.name!.trim(),
        website: o.website_url ?? (o.primary_domain ? `https://${o.primary_domain}` : null),
        city: (o as { city?: string }).city ?? null,
        state: (o as { state?: string }).state ?? null,
      }));
  } catch {
    return [];
  }
}

// --- decision-contact enrichment (person level) -----------------------------
// The gap between an $89 sheet and a premium one: county records name the
// owner LLC; Apollo names the PERSON. Deliberate policy change (Jul 2026):
// buyer-DISCOVERY data still never ships in a sold lead, but decision-contact
// enrichment for the property owner is a product feature of the sheet itself.

export type DecisionContact = {
  name: string;
  title: string | null;
  /** Only a REAL address — Apollo's locked placeholders are dropped. */
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  /** The organization Apollo matched — shown so the buyer can sanity-check. */
  org: string;
};

/** Who actually awards vendor contracts, in priority order. */
const TITLE_PRIORITY = [
  /owner/i,
  /president/i,
  /\bceo\b|chief executive/i,
  /principal/i,
  /managing (partner|director|member)/i,
  /facilit/i, // facilities manager/director
  /property manager|asset manager/i,
  /general manager/i,
  /operations/i,
];

export function pickDecisionPerson<T extends { title?: string | null }>(people: T[]): T | null {
  for (const re of TITLE_PRIORITY) {
    const hit = people.find((p) => p.title && re.test(p.title));
    if (hit) return hit;
  }
  return people[0] ?? null;
}

const ORG_STOPWORDS = new Set([
  "the", "and", "inc", "llc", "llp", "ltd", "corp", "corporation", "company",
  "group", "holdings", "properties", "property", "partners", "trust", "management",
]);
const orgTokens = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((t) => t.length > 2 && !ORG_STOPWORDS.has(t));

/** Does Apollo's matched org plausibly BE the company we asked about? A
 *  significant-token overlap gate so "SMITH FAMILY LP" never returns a
 *  random Smith from another company. */
export function orgNameMatches(expected: string, got: string | null | undefined): boolean {
  if (!got) return false;
  const want = new Set(orgTokens(expected));
  if (!want.size) return false;
  return orgTokens(got).some((t) => want.has(t));
}

type ApolloPerson = {
  id?: string;
  name?: string;
  title?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  phone_numbers?: { sanitized_number?: string }[];
  organization?: { name?: string; primary_domain?: string; phone?: string };
};

/**
 * Find the decision-maker at an owner organization: Apollo people search
 * scoped to the org name, gated on an org-name match, ranked by title.
 * Returns null without a key, on error, or when nothing passes the gate —
 * the sheet then falls back to the county owner + mailing address as before.
 */
export async function findDecisionContact(
  orgName: string | null | undefined,
  opts?: { domain?: string | null }
): Promise<DecisionContact | null> {
  const raw = orgName?.trim();
  const key = getApolloKey();
  if (!raw || !key) return null;
  try {
    const domain =
      opts?.domain?.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase() || null;
    // People search filters by employer DOMAIN; an org-name param is silently
    // ignored, so without a domain the keyword filter is the real scoping.
    const res = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": key },
      body: JSON.stringify({
        ...(domain ? { q_organization_domains_list: [domain] } : { q_keywords: raw }),
        page: 1,
        per_page: 10,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { people?: ApolloPerson[]; contacts?: ApolloPerson[] };
    const candidates = [...(data.people ?? []), ...(data.contacts ?? [])].filter(
      (p) =>
        p.name?.trim() &&
        (orgNameMatches(raw, p.organization?.name) ||
          (domain && p.organization?.primary_domain === domain))
    );
    const person = pickDecisionPerson(candidates);
    if (!person?.name) return null;
    const email =
      person.email && !/not_unlocked|@domain\.|@example\./i.test(person.email) ? person.email : null;
    return {
      name: person.name.trim(),
      title: person.title?.trim() || null,
      email,
      phone: person.phone_numbers?.[0]?.sanitized_number ?? person.organization?.phone ?? null,
      linkedin: person.linkedin_url ?? null,
      org: person.organization?.name?.trim() || raw,
    };
  } catch {
    return null;
  }
}

/**
 * Find a deliverable BUSINESS email for a company we qualified but couldn't
 * scrape one for. Apollo people search scoped to the company name; gated on
 * an org-name match AND (when we know the site) a same-domain email — so the
 * result is the company's own address, never a personal gmail from a namesake.
 * Returns null without a key, on error, or when nothing clears the gate.
 * Enriched companies enter the normal compliant email pipeline (identify +
 * unsubscribe + suppression), same as any scraped address.
 */
export async function findCompanyEmail(
  companyName: string | null | undefined,
  opts?: { domain?: string | null }
): Promise<{ email: string; name: string | null; title: string | null } | null> {
  const raw = companyName?.trim();
  const key = getApolloKey();
  if (!raw || !key) return null;
  const domain = opts?.domain?.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase() || null;
  try {
    const res = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": key },
      // People search filters by employer DOMAIN (q_organization_domains_list);
      // an org-NAME param is not a people-search filter and gets silently
      // ignored — which returned unrelated people our gate then rejected.
      // Without a domain, keywords are the closest supported scoping.
      body: JSON.stringify({
        ...(domain ? { q_organization_domains_list: [domain] } : { q_keywords: raw }),
        page: 1,
        per_page: 10,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { people?: ApolloPerson[]; contacts?: ApolloPerson[] };
    const people = [...(data.people ?? []), ...(data.contacts ?? [])].filter(
      (p) =>
        (p.name?.trim() || p.id) &&
        (orgNameMatches(raw, p.organization?.name) ||
          (domain && p.organization?.primary_domain?.toLowerCase() === domain))
    );
    // Rank by decision authority, then take the first with a real, on-domain
    // (or freemail) email — a wrong-company personal address is worse than none.
    const ok = (e: string | null | undefined): e is string => {
      if (!e || /not_unlocked|@domain\.|@example\./i.test(e)) return false;
      if (!domain) return true;
      const d = e.split("@")[1]?.toLowerCase() ?? "";
      return d === domain || d.endsWith(`.${domain}`) ||
        /@(gmail|yahoo|outlook|hotmail|aol|icloud)\./i.test(e);
    };
    const titleRank = (t?: string | null) => {
      const i = t ? TITLE_PRIORITY.findIndex((re) => re.test(t)) : -1;
      return i === -1 ? TITLE_PRIORITY.length : i; // no ranked title -> last
    };
    const ranked = [...people].sort((a, b) => titleRank(a.title) - titleRank(b.title));
    // Search results carry LOCKED emails (email_not_unlocked@...) — a real
    // address needs the people/match reveal, which spends a credit. Try the
    // top 2 candidates only, so a stubborn company costs at most 2 credits.
    for (const cand of ranked.slice(0, 2)) {
      if (ok(cand.email)) {
        return { email: cand.email!, name: cand.name?.trim() ?? null, title: cand.title?.trim() ?? null };
      }
      // Match by the search result's person id — exact, and immune to the
      // last-name masking search responses apply on some plans.
      if (!cand.id) continue;
      const mres = await fetch("https://api.apollo.io/api/v1/people/match", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": key },
        body: JSON.stringify({
          id: cand.id,
          reveal_personal_emails: false,
        }),
      });
      if (!mres.ok) continue;
      const m = (await mres.json()) as { person?: ApolloPerson };
      if (ok(m.person?.email)) {
        return {
          email: m.person!.email!,
          name: m.person?.name?.trim() ?? cand.name?.trim() ?? null,
          title: m.person?.title?.trim() ?? cand.title?.trim() ?? null,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function enrichCompanyByName(
  ownerName: string | null | undefined
): Promise<OwnerSuggestion | null> {
  const raw = ownerName?.trim();
  if (!raw) return null;

  const parcelOnly = parcelSuggestion(raw);

  const key = getApolloKey();
  if (!key) return parcelOnly;

  try {
    const res = await fetch("https://api.apollo.io/api/v1/mixed_companies/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": key,
      },
      body: JSON.stringify({ q_organization_name: raw, page: 1, per_page: 1 }),
    });
    if (!res.ok) return parcelOnly;
    const data = (await res.json()) as { organizations?: ApolloOrg[]; accounts?: ApolloOrg[] };
    const org = data.organizations?.[0] ?? data.accounts?.[0];
    if (!org) return parcelOnly;

    return {
      raw_owner: raw,
      name: org.name?.trim() || raw,
      domain: org.primary_domain ?? null,
      website: org.website_url ?? null,
      revenue: org.organization_revenue_printed ?? null,
      linkedin: org.linkedin_url ?? null,
      apollo_id: org.id ?? null,
      source: "apollo",
    };
  } catch {
    return parcelOnly;
  }
}
