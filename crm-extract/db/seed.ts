// Minimum viable seed: two brands, the pipeline stages, one admin, and a
// starter set of custom fields. Run once after the first migration.
//
//   npx tsx crm-extract/db/seed.ts
//
// Idempotent — every insert is onConflictDoNothing on a natural key, so re-running
// is safe.

import { db } from "./index";
import { brand, crmUser, customFieldDef, pipelineStage } from "./schema";

/** Stage semantics matter more than labels; rename freely, keep the `kind`.
 *  Exactly one `nurture` stage is expected — it is the long-fuse pool that
 *  revisit_date works on. */
const STAGES: Array<{ key: string; label: string; kind: "open" | "nurture" | "won" | "lost"; sort: number; isDefault?: boolean }> = [
  { key: "identified", label: "Identified", kind: "open", sort: 10, isDefault: true },
  { key: "researching", label: "Researching", kind: "open", sort: 20 },
  { key: "outreach", label: "Outreach sent", kind: "open", sort: 30 },
  { key: "conversation", label: "In conversation", kind: "open", sort: 40 },
  { key: "nurture", label: "Nurture", kind: "nurture", sort: 50 },
  { key: "loi", label: "LOI / diligence", kind: "open", sort: 60 },
  { key: "closed_won", label: "Closed — engaged", kind: "won", sort: 70 },
  { key: "closed_lost", label: "Closed — passed", kind: "lost", sort: 80 },
];

const FIELDS: Array<{
  key: string;
  label: string;
  type: "number" | "text" | "enum" | "boolean" | "date";
  options?: string[];
  sort: number;
}> = [
  { key: "fit_score", label: "Fit score (1-10)", type: "number", sort: 10 },
  { key: "revenue_est", label: "Est. revenue ($)", type: "number", sort: 20 },
  { key: "ebitda_est", label: "Est. EBITDA ($)", type: "number", sort: 30 },
  { key: "employees", label: "Employees", type: "number", sort: 40 },
  {
    key: "sector",
    label: "Sector",
    type: "enum",
    options: ["Manufacturing", "Distribution", "Business services", "Healthcare", "Consumer", "Other"],
    sort: 50,
  },
  {
    key: "owner_situation",
    label: "Owner situation",
    type: "enum",
    options: ["Retiring", "Succession unclear", "Growth capital", "Not exploring", "Unknown"],
    sort: 60,
  },
  { key: "pe_backed", label: "PE-backed", type: "boolean", sort: 70 },
  { key: "founded", label: "Founded", type: "date", sort: 80 },
];

async function main() {
  for (const b of [
    { key: "brand_one", name: "Brand One" },
    { key: "brand_two", name: "Brand Two" },
  ]) {
    await db.insert(brand).values(b).onConflictDoNothing({ target: brand.key });
  }

  for (const s of STAGES) {
    await db
      .insert(pipelineStage)
      .values({
        key: s.key,
        label: s.label,
        kind: s.kind,
        sort_order: s.sort,
        is_default: s.isDefault ?? false,
      })
      .onConflictDoNothing({ target: pipelineStage.key });
  }

  for (const f of FIELDS) {
    await db
      .insert(customFieldDef)
      .values({
        entity: "company",
        key: f.key,
        label: f.label,
        type: f.type,
        options: f.options ?? null,
        sort_order: f.sort,
      })
      .onConflictDoNothing();
  }

  // First admin: set SEED_ADMIN_EMAIL / SEED_ADMIN_NAME before running. Never
  // hardcode a person here.
  const email = process.env.SEED_ADMIN_EMAIL;
  if (email) {
    await db
      .insert(crmUser)
      .values({
        email: email.toLowerCase(),
        name: process.env.SEED_ADMIN_NAME ?? email.split("@")[0],
        role: "admin",
      })
      .onConflictDoNothing({ target: crmUser.email });
  } else {
    console.warn("SEED_ADMIN_EMAIL not set — no admin user created.");
  }

  console.log(
    `Seeded: 2 brands, ${STAGES.length} stages, ${FIELDS.length} custom fields${email ? ", 1 admin" : ""}.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
