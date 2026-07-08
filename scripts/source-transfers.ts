import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { runTransferSourcing } from "../lib/pipeline/transfers";

// Ownership-transfer sourcing CLI — same engine as the weekly cron
// (/api/cron/transfers). Pulls recently-sold commercial parcels from the
// county deed feed, grass-screens them, and adds the qualified ones as
// sourced properties.
//
// Run:  npm run source:transfers              (default: 8 leads, ≥$400k, 12 months)
//       npm run source:transfers -- 5 1000000 6

const WANT = Number(process.argv[2]) || 8;
const MIN_VALUE = Number(process.argv[3]) || 250_000;
const SINCE_MONTHS = Number(process.argv[4]) || 12;

async function main() {
  const summary = await runTransferSourcing({
    want: WANT,
    minMarketValue: MIN_VALUE,
    sinceMonths: SINCE_MONTHS,
  });
  for (const line of summary.log) console.log(`  ${line}`);
  console.log(
    `\nDone. ${summary.added}/${WANT} lead(s) added from ${summary.scanned} transfers ` +
      `(${summary.skippedGrass} failed the grass screen).`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
