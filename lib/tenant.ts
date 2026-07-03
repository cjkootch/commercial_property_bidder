// White-label tenant resolution (Phase 1a of the SaaS plan): one deployment
// serves every tenant's branded public funnel, resolved from the Host header.
//
//   greenkeep.us / www / vercel previews / localhost  -> default company
//   acme.<TENANT_ROOT_DOMAIN>                         -> company with slug "acme"
//   unknown slug                                      -> default company (never 404
//                                                        a marketing page)
//
// Only the PUBLIC funnel is tenant-scoped for now (marketing pages, instant
// quote, quote intake). Operator tools, proposals, and the customer portal stay
// on the default company until Phase 1b (per-tenant operator auth).

import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { company } from "./db/schema";
import { getDefaultCompany } from "./db/queries";

/**
 * Extract the tenant slug from a Host header, given the tenant root domain
 * (e.g. "greenkeep.us"). Pure — unit-tested. Returns null for the default
 * tenant (apex, www, unrelated hosts like *.vercel.app or localhost).
 */
export function slugFromHost(host: string | null | undefined, rootDomain: string | null | undefined): string | null {
  if (!host || !rootDomain) return null;
  const h = host.toLowerCase().split(":")[0].trim();
  const root = rootDomain.toLowerCase().trim();
  if (!h || !root || h === root || h === `www.${root}`) return null;
  if (!h.endsWith(`.${root}`)) return null;
  const sub = h.slice(0, -(root.length + 1));
  // Only single-label subdomains are tenants; "www" and nested labels are not.
  if (!sub || sub === "www" || sub.includes(".")) return null;
  return sub;
}

export type Tenant = NonNullable<Awaited<ReturnType<typeof getDefaultCompany>>>;

/**
 * Resolve the company for the current request's Host header. Falls back to the
 * default company so public pages always render. Call from server components /
 * server actions on PUBLIC funnel surfaces.
 */
export async function resolveTenant(): Promise<Tenant | null> {
  const slug = slugFromHost(headers().get("host"), process.env.TENANT_ROOT_DOMAIN);
  if (slug) {
    const [co] = await db.select().from(company).where(eq(company.slug, slug)).limit(1);
    if (co) return co;
  }
  return getDefaultCompany();
}
