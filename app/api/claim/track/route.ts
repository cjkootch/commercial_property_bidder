import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { claimEvent } from "@/lib/db/schema";
import { verifyBuyerClaim } from "@/lib/buyer-auth";
import { recordClaimView, companyKey } from "@/lib/leads/companies";
import { reserveHold } from "@/lib/leads/holds";
import { asTrade } from "@/lib/leads/trades";

// Client-gated claim tracking. Every functional side effect of *viewing* a
// claim page — the 24h hold, the funnel event, the claim-heat bump — runs HERE,
// fired by a POST from the page's own JS (ClaimTrack), never on the server GET.
// Rationale (2026-07-14): email-security link scanners (Mimecast/Proofpoint/
// Safe-Links) re-fetch claim links hourly and evade UA sniffing, so a GET-time
// hold placed BOGUS holds that blocked real buyers and polluted the funnel.
// Scanners don't execute JS, so gating on this POST cleanly excludes them.
// The token is signed (property is trustworthy); trade/event are analytics.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { token?: string; trade?: string; event?: string; canHold?: boolean };
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 204 });
  }
  const { token, event } = body;
  const trade = asTrade(body.trade);

  const claim = token ? verifyBuyerClaim(token) : null;
  if (!claim) {
    if (event === "view_expired") {
      db.insert(claimEvent).values({ event: "view_expired" }).catch(() => {});
    }
    return new Response(null, { status: 204 });
  }

  // Best-effort — a tracking failure must never surface to the visitor.
  recordClaimView(claim.company).catch(() => {});
  db.insert(claimEvent)
    .values({
      company: claim.company ?? null,
      property_id: claim.property_id,
      trade,
      event: event ?? "view",
    })
    .catch(() => {});
  if (body.canHold && claim.company) {
    reserveHold(claim.property_id, trade, claim.company).catch(() => {});
  }
  // Signal to the page whether the spot ended up held for this company, so it
  // can reflect "held for you" without a full reload.
  return Response.json({ heldForYou: !!(body.canHold && claim.company), key: claim.company ? companyKey(claim.company) : null });
}
