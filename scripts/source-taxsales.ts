import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { runTaxSaleSourcing } from "../lib/pipeline/taxsales";

// Tax-sale (distressed property) sourcing CLI — same engine as the weekly
// cron (/api/cron/taxsales). Pulls the county tax-sale pipeline from the
// public LGBS sale list and keeps commercial/multifamily/vacant-land parcels.
//
// Run:  npm run source:taxsales             (default: 8 leads, >= $100k appraised)
//       npm run source:taxsales -- 10 150000

const WANT = Number(process.argv[2]) || 8;
const MIN_VALUE = Number(process.argv[3]) || 100_000;

async function main() {
  const summary = await runTaxSaleSourcing({ want: WANT, minValue: MIN_VALUE });
  for (const line of summary.log) console.log(`  ${line}`);
  console.log(
    `\nDone. ${summary.added}/${WANT} lead(s) added from ${summary.candidates} tax-sale parcels ` +
      `(${summary.skippedClass} not commercial, ${summary.skippedGrass} bare pavement).`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
