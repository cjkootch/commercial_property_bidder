// Email enrichment for the no-email pool: companies we qualified (right
// vertical, in range) but couldn't scrape a deliverable address for. Apollo
// people search finds the company's own business email; the result flows into
// the SAME compliant pipeline as a scraped one — suppression-checked,
// unsubscribe-able. This is the legitimate automation of "reach the no-email
// companies": no forms, no bots, an inbox that compounds across campaigns.

import { and, eq, isNull, isNotNull, or } from "drizzle-orm";
import { db } from "../db";
import { prospectCompany, suppression } from "../db/schema";
import { findCompanyEmail } from "../integrations/apollo";
import { siteDomainOf } from "../integrations/contact";
import { upsertProspectCompany } from "../leads/companies";

export type EnrichSummary = {
  scanned: number;
  found: number;
  suppressed: number;
  log: string[];
};

/** Walk no-email company profiles that have a website (needed to gate the
 *  match), find a business email via Apollo, and write it back to the graph.
 *  Bounded per run to respect Apollo credits. Never throws. */
export async function runEmailEnrichment(opts?: {
  limit?: number;
  apply?: boolean;
  debug?: boolean;
}): Promise<EnrichSummary> {
  const limit = opts?.limit ?? 25;
  const apply = opts?.apply ?? false;
  const log: string[] = [];

  const targets = await db
    .select()
    .from(prospectCompany)
    .where(and(isNull(prospectCompany.email), isNotNull(prospectCompany.website)))
    .limit(limit);

  const suppressed = new Set(
    (await db.select({ email: suppression.email }).from(suppression)).map((r) => r.email.toLowerCase())
  );

  let found = 0;
  let supp = 0;
  for (const c of targets) {
    const domain = c.website ? siteDomainOf(c.website) : null;
    const trace: string[] = [];
    const hit = await findCompanyEmail(c.name, { domain, ...(opts?.debug ? { trace } : {}) });
    if (opts?.debug) for (const t of trace) log.push(`    [${c.name}] ${t}`);
    if (!hit) {
      log.push(`  · ${c.name} — no Apollo email`);
      continue;
    }
    if (suppressed.has(hit.email.toLowerCase())) {
      supp++;
      log.push(`  ⊘ ${c.name} — ${hit.email} is suppressed, skipped`);
      continue;
    }
    found++;
    log.push(`  ✓ ${c.name} — ${hit.email}${hit.title ? ` (${hit.title})` : ""}`);
    if (apply) {
      // Write to the graph; next campaign for this company's trade picks it up
      // via the normal candidate path (it's no longer no-email).
      await upsertProspectCompany({ name: c.name, email: hit.email, phone: undefined });
    }
  }

  if (!apply && found) log.push(`DRY RUN — ${found} email(s) found; pass ?apply=1 to save.`);
  return { scanned: targets.length, found, suppressed: supp, log };
}
