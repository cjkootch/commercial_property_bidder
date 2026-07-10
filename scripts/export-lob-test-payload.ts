import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";
import * as schema from "../lib/db/schema";
import { formatLobAddressPayload } from "../lib/residential/lob-mail";

// Export what WOULD be sent to Lob for a drafted mail campaign — proof HTML +
// per-recipient address payloads — as a local JSON file for inspection. No
// Lob API calls. Run: npm run residential:lob:export-test-payload <campaign_id>
// (Ported from the Jules mail-foundation branch, adapted to current schema.)

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
const db = drizzle(neon(url), { schema });

async function main() {
  const campaignId = process.argv[2];
  if (!campaignId) {
    console.error("Usage: npm run residential:lob:export-test-payload <campaign_id>");
    process.exit(1);
  }

  const [campaign] = await db
    .select()
    .from(schema.residentialMailCampaign)
    .where(eq(schema.residentialMailCampaign.id, campaignId))
    .limit(1);
  if (!campaign) {
    console.error(`Campaign not found: ${campaignId}`);
    process.exit(1);
  }

  const recipients = await db
    .select()
    .from(schema.residentialMailRecipient)
    .where(eq(schema.residentialMailRecipient.residential_mail_campaign_id, campaignId));
  if (recipients.length === 0) {
    console.error(`Campaign has no recipients: ${campaignId}`);
    process.exit(1);
  }

  const payload = {
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

  const outDir = path.join(process.cwd(), "lob-payloads");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `lob-payload-${campaignId}-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

  console.log("\nLob test payload exported");
  console.log("-------------------------");
  console.log(`Campaign:    ${campaign.name}`);
  console.log(`Recipients:  ${recipients.length}`);
  console.log(`Output:      ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
