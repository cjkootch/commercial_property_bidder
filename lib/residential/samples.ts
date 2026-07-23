// Free sample addresses (2026-07-22 "we're asking too much" funnel fix):
// the pitch email and the public package page both show the SAME 3 freshest
// addresses — the pitch becomes the free sample, and a landscaper can drive
// past those houses today and see the moving boxes. Deterministic selection
// (freshest sale date, address tie-break) so every recipient of a package's
// pitch sees identical rows — we leak 3 addresses per package, not 3 per
// email.

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";

export type SampleLead = { address: string; city: string | null; saleDate: Date | null };

export async function packageSampleLeads(packageId: string, n = 3): Promise<SampleLead[]> {
  const rows = await db
    .select({
      address: schema.residentialLead.address,
      city: schema.residentialLead.city,
      signal_date: schema.residentialLead.signal_date,
    })
    .from(schema.residentialPackageMembership)
    .innerJoin(
      schema.residentialLead,
      eq(schema.residentialPackageMembership.residential_lead_id, schema.residentialLead.id)
    )
    .where(
      and(
        eq(schema.residentialPackageMembership.package_id, packageId),
        isNotNull(schema.residentialLead.address)
      )
    )
    // NULLS LAST explicitly — Postgres sorts NULLs first under DESC, and a
    // date-less row must never displace a fresh sale from the sample.
    .orderBy(
      sql`${schema.residentialLead.signal_date} desc nulls last`,
      schema.residentialLead.address
    )
    .limit(n);
  return rows.map((r) => ({ address: r.address!, city: r.city, saleDate: r.signal_date }));
}

/** "7/8" — short, human, no year (all samples are recent by construction). */
export function fmtSaleDate(d: Date | null): string | null {
  return d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : null;
}
