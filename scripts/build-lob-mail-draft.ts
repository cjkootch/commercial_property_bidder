import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, inArray } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import {
  buildLobMailCampaignDraft,
  validateRecipientAddressShape,
  type MailFormat,
} from "../lib/residential/lob-mail";

/**
 * Builds a Lob mail campaign draft from a residential package.
 *
 * Usage: npm run residential:lob:draft <package_id> [--format postcard_6x9|postcard_6x11|letter]
 */
async function main() {
  const packageId = process.argv[2];
  if (!packageId) {
    console.error("Usage: npm run residential:lob:draft <package_id> [--format <format>]");
    process.exit(1);
  }

  let format: MailFormat = "postcard_6x9";
  const formatIndex = process.argv.indexOf("--format");
  if (formatIndex !== -1 && process.argv[formatIndex + 1]) {
    format = process.argv[formatIndex + 1] as MailFormat;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const db = drizzle(neon(url), { schema });

  // 1. Load package and its leads
  const pkg = await db.query.residentialPackage.findFirst({
    where: eq(schema.residentialPackage.id, packageId),
  });

  if (!pkg) {
    console.error(`Package not found: ${packageId}`);
    process.exit(1);
  }

  const memberships = await db.query.residentialPackageMembership.findMany({
    where: eq(schema.residentialPackageMembership.package_id, packageId),
  });

  if (memberships.length === 0) {
    console.error(`Package has no leads: ${packageId}`);
    process.exit(1);
  }

  const leadIds = memberships.map((m) => m.lead_id);
  const leads = await db.query.residentialLead.findMany({
    where: inArray(schema.residentialLead.id, leadIds),
  });

  // 2. Prepare recipients
  const validRecipients: any[] = [];
  const skippedLeads: any[] = [];

  for (const lead of leads) {
    const validation = validateRecipientAddressShape(lead);
    if (validation.valid) {
      validRecipients.push(lead);
    } else {
      skippedLeads.push({ lead, reasons: validation.reasons });
    }
  }

  if (validRecipients.length === 0) {
    console.error("No leads have valid address shapes.");
    process.exit(1);
  }

  // 3. Load company for draft info
  const company = await db.query.company.findFirst({
    where: eq(schema.company.id, pkg.company_id),
  });

  if (!company) {
    console.error(`Company not found for package: ${pkg.company_id}`);
    process.exit(1);
  }

  // 4. Build draft object
  const draft = buildLobMailCampaignDraft(pkg, validRecipients, {
    company_name: company.name,
    company_phone: company.phone || "555-0199",
    cta_url: `https://${company.slug || "greenkeep"}.greenkeep.us/quote`,
    mail_format: format,
  });

  // 5. Create campaign and recipients
  const [campaign] = await db
    .insert(schema.residentialMailCampaign)
    .values({
      company_id: pkg.company_id,
      residential_package_id: pkg.id,
      name: draft.name,
      mail_format: draft.mail_format as any,
      status: draft.status,
      offer_headline: draft.offer_headline,
      proof_front_html: draft.proof_front_html,
      proof_back_html: draft.proof_back_html,
      mailpiece_count: draft.mailpiece_count,
      estimated_print_postage_cost_cents: draft.estimated_print_postage_cost_cents,
      client_price_cents: draft.client_price_cents,
    })
    .returning();

  for (const lead of validRecipients) {
    await db.insert(schema.residentialMailRecipient).values({
      residential_mail_campaign_id: campaign.id,
      residential_lead_id: lead.id,
      address: lead.address,
      address_line2: lead.address_line2,
      city: lead.city,
      state: lead.state,
      zip: lead.zip,
      recipient_name: lead.recipient_name,
      status: "pending",
    });
  }

  // 6. Print summary
  console.log("\n✅ Campaign Draft Created Successfully");
  console.log("-------------------------------------");
  console.log(`Package Name:    ${pkg.name}`);
  console.log(`Campaign Name:   ${campaign.name}`);
  console.log(`Campaign ID:     ${campaign.id}`);
  console.log(`Format:          ${campaign.mail_format}`);
  console.log(`Recipients:      ${campaign.mailpiece_count}`);
  if (skippedLeads.length > 0) {
    console.log(`Skipped:         ${skippedLeads.length}`);
    skippedLeads.forEach((s) => {
      console.log(`  · ${s.lead.address}: ${s.reasons.join(", ")}`);
    });
  }
  console.log(`Est. Int. Cost:  $${(campaign.estimated_print_postage_cost_cents! / 100).toFixed(2)}`);
  console.log(`Client Price:    $${(campaign.client_price_cents! / 100).toFixed(2)}`);
  console.log("\nReview the proof and recipients in the operator dashboard.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
