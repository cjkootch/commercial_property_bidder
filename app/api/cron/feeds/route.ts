import { NextRequest } from "next/server";
import { MARKETS } from "@/lib/markets";
import { runTaxSaleSourcing } from "@/lib/pipeline/taxsales";
import { runTabcSourcing } from "@/lib/pipeline/tabc";
import { runRfpSourcing } from "@/lib/pipeline/rfps";

// The feed rotor (audit gaps #4 + #5): one cron entry replaces the 27
// per-metro/per-feed entries that were crowding Vercel's 40-cron cap AND
// upgrades freshness from weekly to ~every-2-days per feed. Each invocation
// runs exactly ONE (market, feed) pair, chosen by rotating the current
// 2-hour slot through the registry-derived pair list — stateless, so a
// missed slot self-heals and metro #11+ join the rotation the moment their
// registry entry merges. Re-runs are cheap: every feed dedupes against
// existing leads and the reject cache.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Pair = { market: string; feed: "taxsales" | "tabc" | "rfps" };

function rotation(): Pair[] {
  const pairs: Pair[] = [];
  for (const m of Object.values(MARKETS)) {
    pairs.push({ market: m.key, feed: "taxsales" });
    pairs.push({ market: m.key, feed: "tabc" });
    if (m.bonfirePortals.length) pairs.push({ market: m.key, feed: "rfps" });
  }
  return pairs;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const pairs = rotation();
  // Slot index from the wall clock (2h grain, matching the cron cadence).
  // ?slot= lets an operator run a specific pair by index for debugging.
  const forced = Number(req.nextUrl.searchParams.get("slot"));
  const slot = Number.isFinite(forced) && forced >= 0
    ? forced % pairs.length
    : Math.floor(Date.now() / (2 * 3600_000)) % pairs.length;
  const pair = pairs[slot];

  const summary =
    pair.feed === "taxsales"
      ? await runTaxSaleSourcing({ want: 15, market: pair.market })
      : pair.feed === "tabc"
        ? await runTabcSourcing({ want: 15, market: pair.market })
        : await runRfpSourcing({ market: pair.market });

  return Response.json({ slot, of: pairs.length, market: pair.market, feed: pair.feed, summary });
}
