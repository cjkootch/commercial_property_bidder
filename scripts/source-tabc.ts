import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { runTabcSourcing } from "../lib/pipeline/tabc";

// TABC pending-license sourcing CLI — same engine as the weekly cron
// (/api/cron/tabc). Pulls pending original alcohol-license applications
// (Harris County) and keeps venues on commercial parcels with real grounds.
//
// Run:  npm run source:tabc             (default: 8 leads, last 120 days)
//       npm run source:tabc -- 10 60

const WANT = Number(process.argv[2]) || 8;
const SINCE_DAYS = Number(process.argv[3]) || 120;

async function main() {
  const summary = await runTabcSourcing({ want: WANT, sinceDays: SINCE_DAYS });
  for (const line of summary.log) console.log(`  ${line}`);
  console.log(
    `\nDone. ${summary.added}/${WANT} lead(s) added from ${summary.candidates} pending applications ` +
      `(${summary.skippedClass} not on commercial parcels, ${summary.skippedGrass} failed the grass screen).`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
