import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

// Manual pipeline run with roomier caps than the nightly cron. NEVER sends
// email — it fills the /queue for operator approval.
//
// Run:  npm run pipeline                 (source 5, price 10, contacts 8)
//       npm run pipeline -- 0 0 0        (queue-only pass: no network work)

async function main() {
  const { runPipeline } = await import("../lib/pipeline/runner");
  const num = (i: number, dflt: number) => {
    const v = Number(process.argv[2 + i]);
    return Number.isFinite(v) && v >= 0 ? v : dflt;
  };
  const caps = {
    sourceNew: num(0, 5),
    price: num(1, 10),
    contacts: num(2, 8),
    sourceLookups: 40,
  };
  console.log(`Running pipeline (source ${caps.sourceNew}, price ${caps.price}, contacts ${caps.contacts})…\n`);
  const s = await runPipeline(caps);

  const section = (label: string, items: string[]) => {
    console.log(`${label} (${items.length})`);
    for (const i of items) console.log(`  · ${i}`);
  };
  section("sourced", s.sourced);
  section("priced", s.priced);
  section("proposals", s.proposals);
  section("contacts", s.contacts);
  section("queued for approval", s.queued);
  console.log(`blocked (no contact email): ${s.blocked_no_contact}`);
  if (s.errors.length) {
    console.log(`\nerrors (${s.errors.length}):`);
    for (const e of s.errors) console.log(`  ! ${e}`);
  }
  console.log("\nDone. Review & approve sends at /queue.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
