import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { runRfpSourcing } from "../lib/pipeline/rfps";

// Public-bid sourcing CLI — same engine as the weekly cron (/api/cron/rfps).
// Polls the Houston-area Bonfire procurement portals for open grounds/
// landscaping solicitations.
//
// Run:  npm run source:rfps             (default: up to 10)
//       npm run source:rfps -- 20

const WANT = Number(process.argv[2]) || 10;

async function main() {
  const summary = await runRfpSourcing({ want: WANT });
  for (const line of summary.log) console.log(`  ${line}`);
  console.log(
    `\nDone. ${summary.added} public-bid lead(s) added from ${summary.candidates} open grounds solicitations across ${summary.scanned} portal(s).`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
