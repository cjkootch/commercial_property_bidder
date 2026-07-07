import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { runPermitSourcing } from "../lib/pipeline/permits";

// Permit-timed sourcing CLI — same engine as the weekly cron
// (/api/cron/permits). Ingests big-ticket TABS registrations, sizes the
// marketplace teaser, and alerts opted-in buyers.
//
// Run:  npm run source:permits              (default: 8 leads, ≥$500k, 45 days)
//       npm run source:permits -- 5 1000000 60

const WANT = Number(process.argv[2]) || 8;
const MIN_COST = Number(process.argv[3]) || 500_000;
const SINCE_DAYS = Number(process.argv[4]) || 45;

async function main() {
  const summary = await runPermitSourcing({ want: WANT, minCost: MIN_COST, sinceDays: SINCE_DAYS });
  for (const line of summary.log) console.log(`  ${line}`);
  console.log(
    `\nDone. ${summary.added}/${WANT} lead(s) added from ${summary.scanned} registrations; ` +
      `${summary.notified} buyer alert(s) sent.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
