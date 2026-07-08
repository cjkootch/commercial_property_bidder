import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { runViolationSourcing } from "../lib/pipeline/violations";

// Grounds-violation sourcing CLI — same engine as the weekly cron
// (/api/cron/violations). Pulls Houston 311's nightly extract and keeps open
// weeds/overgrowth citations on commercial/multifamily parcels.
//
// Run:  npm run source:violations             (default: 8 leads, last 14 days)
//       npm run source:violations -- 10 7

const WANT = Number(process.argv[2]) || 8;
const SINCE_DAYS = Number(process.argv[3]) || 14;

async function main() {
  const summary = await runViolationSourcing({ want: WANT, sinceDays: SINCE_DAYS });
  for (const line of summary.log) console.log(`  ${line}`);
  console.log(
    `\nDone. ${summary.added}/${WANT} lead(s) added from ${summary.candidates} open citations ` +
      `(${summary.skippedClass} on non-commercial parcels).`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
