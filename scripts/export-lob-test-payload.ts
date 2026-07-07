import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import * as fs from "fs";
import * as path from "path";
import { formatLobAddressPayload } from "../lib/residential/lob-mail";

/**
 * Exports a Lob test payload for a residential mail campaign.
 *
 * Usage: npm run residential:lob:export-test-payload <campaign_id>
 */
async function main() {
  const campaignId = process.argv[2];
  if (!campaignId) {
    console.error("Usage: npm run residential:lob:export-test-payload <campaign_id>");
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const db = drizzle(neon(url), { schema });

  // 1. Load campaign and recipients
  const campaign = await db.query.residentialMailCampaign.findFirst({
    where: eq(schema.residentialMailCampaign.id, campaignId),
  });

  if (!campaign) {
    console.error(`Campaign not found: ${campaignId}`);
    process.exit(1);
  }

  const recipients = await db.query.residentialMailRecipient.findMany({
    where: eq(schema.residentialMailRecipient.residential_mail_campaign_id, campaignId),
  });

  if (recipients.length === 0) {
    console.error(`Campaign has no recipients: ${campaignId}`);
    process.exit(1);
  }

  // 2. Format payload
  const lobPayload = {
    campaign_info: {
      id: campaign.id,
      name: campaign.name,
      mail_format: campaign.mail_format,
      offer_headline: campaign.offer_headline,
    },
    proof: {
      front: campaign.proof_front_html,
      back: campaign.proof_back_html,
    },
    recipients: recipients.map((r) => ({
      recipient_id: r.id,
      lead_id: r.residential_lead_id,
      lob_address: formatLobAddressPayload(r),
    })),
    metadata: {
      company_id: campaign.company_id,
      residential_package_id: campaign.residential_package_id,
      exported_at: new Date().toISOString(),
    },
  };

  // 3. Save to file
  const outputDir = path.join(process.cwd(), "lob-payloads");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  const filename = `lob-payload-${campaignId}-${Date.now()}.json`;
  const outputPath = path.join(outputDir, filename);

  fs.writeFileSync(outputPath, JSON.stringify(lobPayload, null, 2));

  console.log(`\n✅ Lob Test Payload Exported Successfully`);
  console.log("------------------------------------------");
  console.log(`Campaign:    ${campaign.name}`);
  console.log(`Recipients:  ${recipients.length}`);
  console.log(`Output:      ${outputPath}`);
  console.log("\nYou can now inspect this JSON to see what would be sent to Lob.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
