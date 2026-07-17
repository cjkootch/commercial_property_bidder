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
// Short-TTL memo (2026-07-17 audit): the demand engines re-issue IDENTICAL
// company searches — every campaign in the same metro, every residential wave
// against the same package shelf — up to ~42/day, each returning the same
// 100-org page. Vercel reuses warm function containers, so a module-level
// cache gets real hits across the 3 campaigns of one invocation AND across
// waves, roughly halving Apollo search spend. Cold starts just miss and pay.
const searchMemo = new Map<string, { at: number; data: BuyerCandidate[] }>();
const SEARCH_MEMO_TTL_MS = 2 * 3600_000;

export async function searchLandscapers(
  location = "Houston, Texas",
  perPage = 25,
  keywords: string[] = ["landscaping", "lawn care", "grounds maintenance"],
  page = 1
): Promise<BuyerCandidate[]> {
  const key = getApolloKey();
  if (!key) return [];
  const memoKey = `${location}|${perPage}|${[...keywords].sort().join(",")}|p${page}`;
  const hit = searchMemo.get(memoKey);
  if (hit && Date.now() - hit.at < SEARCH_MEMO_TTL_MS) return [...hit.data];
  try {
    const res = await fetch("https://api.apollo.io/api/v1/mixed_companies/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": key },
      body: JSON.stringify({
        q_organization_keyword_tags: keywords,
        organization_locations: [location],
        page,
        per_page: perPage,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { organizations?: ApolloOrg[]; accounts?: ApolloOrg[] };
    const orgs = [...(data.organizations ?? []), ...(data.accounts ?? [])];
    const out = orgs
      .filter((o) => o.name?.trim())
      .map((o) => ({
        name: o.name!.trim(),
        website: o.website_url ?? (o.primary_domain ? `https://${o.primary_domain}` : null),
        city: (o as { city?: string }).city ?? null,
        state: (o as { state?: string }).state ?? null,
      }));
    // Only cache useful pages — an empty result may be a transient error and
    // must not poison two hours of discovery for that metro.
    if (out.length > 0) {
      if (searchMemo.size > 50) searchMemo.clear(); // tiny bound, tiny data
      searchMemo.set(memoKey, { at: Date.now(), data: out });
    }
    return [...out];
  } catch {
    return [];
  }
}

/** Pages of discovery to fetch at most per search (env APOLLO_MAX_PAGES). */
export function apolloMaxPages(): number {
  const n = Number(process.env.APOLLO_MAX_PAGES);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

/**
 * Depth-aware discovery (2026-07-17 launch-day fix): page-1-only search hands
 * back the SAME 100 orgs per metro forever — after weeks of outreach the
 * whole first page is cooled down or email-less, and daily sends decayed
 * 45→45→25→18→0 while page 2+ sat unfetched. Keep pulling pages until
 * `wantFresh` candidates pass the caller's `isFresh` screen (name-level
 * exclusions — cooldown, accounts, blocked) or the well runs dry, bounded by
 * apolloMaxPages(). Per-page results ride the same 2h memo, so repeat waves
 * don't re-spend search credits.
 */
export async function searchLandscapersDeep(
  location: string,
  perPage: number,
  keywords: string[],
  isFresh: (c: BuyerCandidate) => boolean,
  wantFresh: number
): Promise<BuyerCandidate[]> {
  const all: BuyerCandidate[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= apolloMaxPages(); page++) {
    const batch = await searchLandscapers(location, perPage, keywords, page);
    if (!batch.length) break;
    for (const c of batch) {
      const k = c.name.trim().toLowerCase().replace(/\s+/g, " ");
      if (seen.has(k)) continue;
      seen.add(k);
      all.push(c);
    }
    if (all.filter(isFresh).length >= wantFresh) break;
    if (batch.length < perPage) break; // short page = the well is dry
  }
  return all;
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
  // Multi-token names must overlap on TWO significant tokens: one shared
  // word ("Lone Star X" vs "Lone Star Y") matched half of Texas. Single-token
  // names ("Weathermatic") still match on their one token.
  const overlap = orgTokens(got).filter((t) => want.has(t)).length;
  return overlap >= Math.min(2, want.size);
}

type ApolloPerson = {
  id?: string;
  name?: string;
  title?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  // Apollo tags each number with a type ("mobile", "work_hq", "home", …). We
  // want the mobile for SMS; the org main line is the worst case.
  phone_numbers?: { sanitized_number?: string; type?: string | null; type_cd?: string | null }[];
  organization?: { name?: string; primary_domain?: string; phone?: string };
};

/** Pick the best SMS target from an Apollo person's numbers: a mobile-typed
 *  number wins; otherwise null (a work/main line is NOT worth swapping in — the
 *  recovery caller falls back to a website scrape). */
export function pickMobileNumber(
  phones: { sanitized_number?: string; type?: string | null; type_cd?: string | null }[] | undefined
): string | null {
  if (!phones?.length) return null;
  const isMobile = (p: { type?: string | null; type_cd?: string | null }) =>
    /mobile|cell/i.test(`${p.type ?? ""} ${p.type_cd ?? ""}`);
  const mobile = phones.find((p) => p.sanitized_number && isMobile(p));
  return mobile?.sanitized_number ?? null;
}

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
    // api_search is the API-caller endpoint (the old mixed_people/search 422s);
    // it returns no emails and masks last names, so the picked person is
    // completed via a people/match reveal (1 Apollo credit).
    const res = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
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
        (p.name?.trim() || p.id) &&
        (orgNameMatches(raw, p.organization?.name) ||
          (domain && p.organization?.primary_domain?.toLowerCase() === domain))
    );
    const person = pickDecisionPerson(candidates);
    if (!person) return null;
    let full: ApolloPerson = person;
    if ((!person.name?.trim() || !person.email || /not_unlocked/i.test(person.email)) && person.id) {
      const mres = await fetch("https://api.apollo.io/api/v1/people/match", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": key },
        body: JSON.stringify({ id: person.id, reveal_personal_emails: false }),
      });
      if (mres.ok) {
        const m = (await mres.json()) as { person?: ApolloPerson };
        if (m.person) full = { ...person, ...m.person };
      }
    }
    if (!full.name?.trim()) return null;
    const email =
      full.email && !/not_unlocked|@domain\.|@example\./i.test(full.email) ? full.email : null;
    return {
      name: full.name.trim(),
      title: full.title?.trim() || null,
      email,
      phone:
        pickMobileNumber(full.phone_numbers) ??
        full.phone_numbers?.[0]?.sanitized_number ??
        full.organization?.phone ??
        null,
      linkedin: full.linkedin_url ?? null,
      org: full.organization?.name?.trim() || raw,
    };
  } catch {
    return null;
  }
}

/**
 * Find the decision-maker's MOBILE number for a company — the recovery lever
 * when the number on file carrier-rejected an SMS. Same search + match flow as
 * findDecisionContact, but requests a phone reveal and returns ONLY a
 * mobile-typed number (a work/main line isn't worth swapping for). Returns
 * null without a key, on error, or when no mobile surfaces. Phone reveal costs
 * an Apollo credit, so call this reactively (on a proven bounce), not in bulk.
 */
export async function findOwnerMobile(
  orgName: string | null | undefined,
  opts?: { domain?: string | null }
): Promise<string | null> {
  const raw = orgName?.trim();
  const key = getApolloKey();
  if (!raw || !key) return null;
  try {
    const domain =
      opts?.domain?.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase() || null;
    const res = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
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
        (p.name?.trim() || p.id) &&
        (orgNameMatches(raw, p.organization?.name) ||
          (domain && p.organization?.primary_domain?.toLowerCase() === domain))
    );
    const person = pickDecisionPerson(candidates);
    if (!person?.id) return pickMobileNumber(person?.phone_numbers);
    // reveal_phone_number pulls the person's numbers (incl. mobile). No
    // webhook_url — read what the sync response carries; if a plan defers the
    // reveal, phone_numbers comes back empty and the caller scrapes instead.
    const mres = await fetch("https://api.apollo.io/api/v1/people/match", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": key },
      body: JSON.stringify({ id: person.id, reveal_phone_number: true }),
    });
    if (!mres.ok) return pickMobileNumber(person.phone_numbers);
    const m = (await mres.json()) as { person?: ApolloPerson };
    return pickMobileNumber(m.person?.phone_numbers) ?? pickMobileNumber(person.phone_numbers);
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
  opts?: { domain?: string | null; trace?: string[] }
): Promise<{ email: string; name: string | null; title: string | null } | null> {
  const raw = companyName?.trim();
  const key = getApolloKey();
  const trace = (s: string) => opts?.trace?.push(s);
  if (!raw || !key) {
    trace(!key ? "no APOLLO key" : "no name");
    return null;
  }
  const domain = opts?.domain?.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase() || null;
  try {
    // api_search is the API-caller endpoint (the old mixed_people/search 422s
    // with a deprecation error for API keys).
    const res = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
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
    if (!res.ok) {
      trace(`search HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
      return null;
    }
    const data = (await res.json()) as { people?: ApolloPerson[]; contacts?: ApolloPerson[] };
    const all = [...(data.people ?? []), ...(data.contacts ?? [])];
    const people = all.filter(
      (p) =>
        (p.name?.trim() || p.id) &&
        (orgNameMatches(raw, p.organization?.name) ||
          (domain && p.organization?.primary_domain?.toLowerCase() === domain))
    );
    trace(
      `search domain=${domain} raw=${all.length} gated=${people.length}` +
        (all.length && !people.length
          ? ` (sample org: ${all[0]?.organization?.name ?? "?"} / ${all[0]?.organization?.primary_domain ?? "?"})`
          : "")
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
      if (!cand.id) {
        trace("candidate without id, skipped");
        continue;
      }
      const mres = await fetch("https://api.apollo.io/api/v1/people/match", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": key },
        body: JSON.stringify({
          id: cand.id,
          reveal_personal_emails: false,
        }),
      });
      if (!mres.ok) {
        trace(`match HTTP ${mres.status}: ${(await mres.text().catch(() => "")).slice(0, 200)}`);
        continue;
      }
      const m = (await mres.json()) as { person?: ApolloPerson };
      if (!ok(m.person?.email)) {
        trace(`match returned email=${m.person?.email ?? "none"} (rejected by gate)`);
      }
      if (ok(m.person?.email)) {
        return {
          email: m.person!.email!,
          name: m.person?.name?.trim() ?? cand.name?.trim() ?? null,
          title: m.person?.title?.trim() ?? cand.title?.trim() ?? null,
        };
      }
    }
    return null;
  } catch (e) {
    trace(`threw: ${e instanceof Error ? e.message : String(e)}`);
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
