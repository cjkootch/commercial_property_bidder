import { NextRequest } from "next/server";
import { gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { claimEvent } from "@/lib/db/schema";
import { verifyBuyerClaim } from "@/lib/buyer-auth";
import { recordClaimView, companyKey } from "@/lib/leads/companies";
import { reserveHold } from "@/lib/leads/holds";
import { asTrade } from "@/lib/leads/trades";
import {
  TRACK_MIN_DWELL_MS,
  hashIp,
  isCrossTokenScanner,
  isDuplicateFire,
  type RecentEvent,
} from "@/lib/leads/track-guards";

// Client-gated claim tracking. Every functional side effect of *viewing* a
// claim page — the 24h hold, the funnel event, the claim-heat bump — runs HERE,
// fired by the page's own JS (ClaimTrack), never on the server GET.
// The arms race so far: GET-time tracking lost to link scanners (2026-07-14),
// mount-time JS lost to headless browsers (#255), and input-gating alone lost
// to input-simulating appliances (2026-07-16: one machine visited a stale
// link, then a fresh one twice, 24ms apart). Now layered: client input +
// dwell, server double-fire dedupe, and a cross-token IP rule — one machine
// producing events for two different companies' links is a scanner, always.
// The token is signed (property is trustworthy); trade/event are analytics.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: {
    token?: string;
    trade?: string;
    event?: string;
    canHold?: boolean;
    dwellMs?: number;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 204 });
  }
  const { token, event } = body;
  const trade = asTrade(body.trade);
  const now = new Date();

  const ipRaw =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;
  const ipHash = hashIp(ipRaw, process.env.AUTH_SECRET ?? "gk");

  const claim = token ? verifyBuyerClaim(token) : null;
  const company = claim?.company ?? null;

  // One 10-minute window of history answers both guard questions.
  const recent: RecentEvent[] = await db
    .select({
      company: claimEvent.company,
      property_id: claimEvent.property_id,
      event: claimEvent.event,
      ip_hash: claimEvent.ip_hash,
      created_at: claimEvent.created_at,
    })
    .from(claimEvent)
    .where(gte(claimEvent.created_at, new Date(now.getTime() - 10 * 60_000)))
    .catch(() => [] as RecentEvent[]);

  const scanner = isCrossTokenScanner(recent, { ipHash, company }, now);
  const dup = isDuplicateFire(
    recent,
    { company, propertyId: claim?.property_id ?? null, event: event ?? "view" },
    now
  );
  const dwellOk = (body.dwellMs ?? 0) >= TRACK_MIN_DWELL_MS;

  if (!claim) {
    // Expired-token views are logged (they're the cross-token rule's best
    // evidence) unless they're themselves duplicates.
    if (event === "view_expired" && !dup) {
      db.insert(claimEvent).values({ event: "view_expired", ip_hash: ipHash }).catch(() => {});
    }
    return new Response(null, { status: 204 });
  }

  if (dup || scanner || !dwellOk) {
    // No hold, no funnel row, no heat — but the answer is shaped normally so
    // the page (and the scanner) can't tell it was filtered.
    return Response.json({ heldForYou: false, key: company ? companyKey(company) : null });
  }

  // Best-effort — a tracking failure must never surface to the visitor.
  recordClaimView(claim.company).catch(() => {});
  db.insert(claimEvent)
    .values({
      company: claim.company ?? null,
      property_id: claim.property_id,
      trade,
      event: event ?? "view",
      ip_hash: ipHash,
    })
    .catch(() => {});
  if (body.canHold && claim.company) {
    reserveHold(claim.property_id, trade, claim.company).catch(() => {});
  }
  // Signal to the page whether the spot ended up held for this company, so it
  // can reflect "held for you" without a full reload.
  return Response.json({
    heldForYou: !!(body.canHold && claim.company),
    key: claim.company ? companyKey(claim.company) : null,
  });
}
