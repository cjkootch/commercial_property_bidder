import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import QRCode from "qrcode";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, prospect } from "@/lib/db/schema";
import { BUYER_COOKIE, verifyBuyerSession } from "@/lib/buyer-auth";
import { getDefaultCompany } from "@/lib/db/queries";
import { buildProspectPostcardHtml } from "@/lib/leads/postcard-art";
import { renderPostcardPreviewPage } from "@/lib/leads/postcard-preview";
import type { DossierAerial } from "@/lib/leads/dossier";

// Preview the prospect postcard before paying to mail it. Ownership-scoped; uses
// the buyer's LIVE profile + the scanned aerial + a QR to the quote microsite.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const buyerId = verifyBuyerSession(cookies().get(BUYER_COOKIE)?.value);
  if (!buyerId) return new NextResponse("Sign in required", { status: 401 });

  const [p] = await db
    .select()
    .from(prospect)
    .where(and(eq(prospect.id, params.id), eq(prospect.buyer_id, buyerId)))
    .limit(1);
  if (!p) return new NextResponse("Not found", { status: 404 });

  const [me] = await db.select().from(buyer).where(eq(buyer.id, buyerId)).limit(1);
  const co = await getDefaultCompany();
  const accent = co?.brand_color || "#2f7d4f";
  const aerial = p.aerial as DossierAerial | null;
  // Relative asset URL resolves against this origin inside the preview iframe.
  const aerialImageUrl = aerial?.image ? `/api/postcard-asset/${p.proposal_slug}` : null;
  const proposalUrl = `/quote/${p.proposal_slug}`;
  const qrDataUrl = await QRCode.toDataURL(proposalUrl, { width: 480, margin: 1 }).catch(() => "");

  const { front, back } = buildProspectPostcardHtml({
    prospect: {
      name: p.name,
      city: p.city,
      aerial,
      turf_sqft: p.turf_sqft,
      monthly: p.price_override_cents != null ? p.price_override_cents / 100 : p.monthly_price,
      estimate_lo: p.estimate_lo,
      estimate_hi: p.estimate_hi,
    },
    buyer: me ?? { company_name: "Your company" },
    proposalUrl,
    qrDataUrl,
    aerialImageUrl,
    accent,
  });

  return new NextResponse(renderPostcardPreviewPage(front, back), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
