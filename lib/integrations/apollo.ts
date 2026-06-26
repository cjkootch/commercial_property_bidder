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
  industry: string | null;
  employees: number | null;
  apollo_id: string | null;
  /** "apollo" when enriched, "parcel" when we only have the owner-of-record. */
  source: "apollo" | "parcel";
};

/** Server-side Apollo key. Supports either env name; null disables enrichment. */
export function getApolloKey(): string | null {
  return process.env.APOLLO_API_KEY ?? process.env.APOLLO_API ?? null;
}

type ApolloOrg = {
  id?: string;
  name?: string;
  primary_domain?: string;
  website_url?: string;
  industry?: string;
  estimated_num_employees?: number;
};

/**
 * Search Apollo for the company that best matches `ownerName` and return a
 * canonical OwnerSuggestion. Falls back to a `source: "parcel"` suggestion
 * (just the raw name) when there's no API key or no match — so the operator
 * always gets at least the owner-of-record to confirm. Never throws.
 */
export async function enrichCompanyByName(
  ownerName: string | null | undefined
): Promise<OwnerSuggestion | null> {
  const raw = ownerName?.trim();
  if (!raw) return null;

  const parcelOnly: OwnerSuggestion = {
    raw_owner: raw,
    name: raw,
    domain: null,
    website: null,
    industry: null,
    employees: null,
    apollo_id: null,
    source: "parcel",
  };

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
      industry: org.industry ?? null,
      employees: typeof org.estimated_num_employees === "number" ? org.estimated_num_employees : null,
      apollo_id: org.id ?? null,
      source: "apollo",
    };
  } catch {
    return parcelOnly;
  }
}
