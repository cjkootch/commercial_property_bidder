import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import {
  buildLobMailCampaignDraft,
  validateRecipientAddressShape,
  type MailFormat,
} from "../lib/residential/lob-mail";

// Draft a Lob direct-mail campaign from a residential package: validate every
// member address, build the proof HTML + pricing, and land it as a
// proof_ready campaign for operator review. No Lob API calls — drafting only.
// Run: npm run residential:lob:draft <package_id> [--format postcard_6x9|postcard_6x11|letter]
// (Ported from the Jules mail-foundation branch, adapted to current schema.)

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
const db = drizzle(neon(url), { schema });

async function main() {
  const packageId = process.argv[2];
  if (!packageId) {
    console.error("Usage: npm run residential:lob:draft <package_id> [--format <format>]");
    process.exit(1);
  }
  let format: MailFormat = "postcard_6x9";
  const fi = process.argv.indexOf("--format");
  if (fi !== -1 && process.argv[fi + 1]) format = process.argv[fi + 1] as MailFormat;

  const [pkg] = await db
    .select()
    .from(schema.residentialPackage)
    .where(eq(schema.residentialPackage.id, packageId))
    .limit(1);
  if (!pkg) {
    console.error(`Package not found: ${packageId}`);
    process.exit(1);
  }

  const rows = await db
    .select({ lead: schema.residentialLead })
    .from(schema.residentialPackageMembership)
    .innerJoin(
      schema.residentialLead,
      eq(schema.residentialPackageMembership.residential_lead_id, schema.residentialLead.id)
    )
    .where(eq(schema.residentialPackageMembership.package_id, packageId));
  if (rows.length === 0) {
    console.error(`Package has no leads: ${packageId}`);
    process.exit(1);
  }

  const valid: { address: string; city: string; state: string; zip: string; id: string }[] = [];
  const skipped: { address: string | null; reasons: string[] }[] = [];
  for (const { lead } of rows) {
    const shape = {
      address: lead.address ?? "",
      city: lead.city ?? "",
      state: lead.state ?? "",
      zip: lead.zip ?? "",
    };
    const v = validateRecipientAddressShape(shape);
    if (v.valid) valid.push({ ...shape, id: lead.id });
    else skipped.push({ address: lead.address, reasons: v.reasons });
  }
  if (valid.length === 0) {
    console.error("No leads have complete mailing addresses.");
    process.exit(1);
  }

  const [co] = await db
    .select()
    .from(schema.company)
    .where(eq(schema.company.id, pkg.company_id))
    .limit(1);
  if (!co) {
    console.error(`Company not found for package: ${pkg.company_id}`);
    process.exit(1);
  }

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "") || "https://greenkeep.us";
  const draft = buildLobMailCampaignDraft(pkg, valid, {
    company_name: co.name,
    company_phone: co.phone || "",
    cta_url: `${base}/quote`,
    mail_format: format,
  });

  const [campaign] = await db
    .insert(schema.residentialMailCampaign)
    .values({
      company_id: pkg.company_id,
      residential_package_id: pkg.id,
      name: draft.name,
      mail_format: draft.mail_format,
      status: draft.status,
      offer_headline: draft.offer_headline,
      proof_front_html: draft.proof_front_html,
      proof_back_html: draft.proof_back_html,
      mailpiece_count: draft.mailpiece_count,
      estimated_print_postage_cost_cents: draft.estimated_print_postage_cost_cents,
      client_price_cents: draft.client_price_cents,
    })
    .returning();

  for (const r of valid) {
    await db.insert(schema.residentialMailRecipient).values({
      residential_mail_campaign_id: campaign.id,
      residential_lead_id: r.id,
      address: r.address,
      city: r.city,
      state: r.state,
      zip: r.zip,
      status: "pending",
    });
  }

  console.log("\nCampaign draft created");
  console.log("----------------------");
  console.log(`Package:        ${pkg.name}`);
  console.log(`Campaign:       ${campaign.name}`);
  console.log(`Campaign id:    ${campaign.id}`);
  console.log(`Format:         ${campaign.mail_format}`);
  console.log(`Recipients:     ${campaign.mailpiece_count}`);
  if (skipped.length) {
    console.log(`Skipped:        ${skipped.length}`);
    for (const s of skipped) console.log(`  · ${s.address ?? "(no address)"}: ${s.reasons.join(", ")}`);
  }
  console.log(`Est. cost:      $${((campaign.estimated_print_postage_cost_cents ?? 0) / 100).toFixed(2)}`);
  console.log(`Client price:   $${((campaign.client_price_cents ?? 0) / 100).toFixed(2)}`);
  console.log("\nReview the proof in the operator dashboard (/dashboard/residential/mail).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
