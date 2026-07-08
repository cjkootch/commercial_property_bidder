import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { existsSync, readFileSync } from "node:fs";
import { runBuyerProspecting } from "../lib/pipeline/buyer-prospecting";
import type { BuyerCandidate } from "../lib/integrations/apollo";

// Automated buyer prospecting CLI — same engine as the weekly cron
// (/api/cron/prospecting). Picks the best fresh uncampaigned lead (or the one
// you name), qualifies ~30 outside landscaping companies (coverage,
// commercial signal, found email), and queues personalized free-claim offers.
// QUEUES by default; pass --send to actually send (that IS the operator
// approval), or set PROSPECTING_AUTOSEND=1 for standing approval.
//
// Candidate source: Apollo (APOLLO_API_KEY) — or campaign/buyers.csv
// (name,website,address) when present, same file the campaign kit uses.
//
// Run:  npm run prospect:buyers                     (auto-pick lead, queue)
//       npm run prospect:buyers -- <propertyId>     (specific lead)
//       npm run prospect:buyers -- <propertyId> 30 --send

const args = process.argv.slice(2).filter((a) => a !== "--send");
const SEND = process.argv.includes("--send");
const PROPERTY_ID = args[0] && /^[0-9a-f-]{36}$/i.test(args[0]) ? args[0] : undefined;
const WANT = Number(args[PROPERTY_ID ? 1 : 0]) || undefined;

function csvCandidates(): BuyerCandidate[] | undefined {
  if (!existsSync("campaign/buyers.csv")) return undefined;
  const rows = readFileSync("campaign/buyers.csv", "utf8").trim().split("\n");
  const out: BuyerCandidate[] = [];
  for (const row of rows.slice(1)) {
    const [name, website, address] = row.split(",").map((s) => s?.trim());
    if (!name) continue;
    out.push({ name, website: website || null, city: address || null, state: null });
  }
  console.log(`  ${out.length} candidate(s) from campaign/buyers.csv`);
  return out;
}

async function main() {
  const summary = await runBuyerProspecting({
    propertyId: PROPERTY_ID,
    want: WANT,
    send: SEND || undefined,
    candidates: csvCandidates(),
  });
  for (const line of summary.log) console.log(`  ${line}`);
  console.log(
    `\nDone. ${summary.qualified}/${summary.candidates} qualified, ${summary.queued} queued, ` +
      `${summary.sent} sent (${summary.skippedNoEmail} had no findable email — recorded for manual paste).`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
