import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { runOpeningSourcing } from "../lib/pipeline/openings";

// New-business-opening sourcing CLI — same engine as the weekly cron
// (/api/cron/openings). Pulls fresh sales-tax registrations at corridor
// addresses, keeps the ones landing on real commercial (F1) parcels with
// grass, and adds them as sourced properties.
//
// Run:  npm run source:openings              (default: 8 leads, last 30 days)
//       npm run source:openings -- 5 60

const WANT = Number(process.argv[2]) || 8;
const SINCE_DAYS = Number(process.argv[3]) || 30;

async function main() {
  const summary = await runOpeningSourcing({ want: WANT, sinceDays: SINCE_DAYS });
  for (const line of summary.log) console.log(`  ${line}`);
  console.log(
    `\nDone. ${summary.added}/${WANT} lead(s) added from ${summary.scanned} registrations ` +
      `(${summary.skippedClass} not on commercial parcels, ${summary.skippedGrass} failed the grass screen).`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
