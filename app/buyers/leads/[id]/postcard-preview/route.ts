import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, leadUnlock } from "@/lib/db/schema";
import { BUYER_COOKIE, verifyBuyerSession } from "@/lib/buyer-auth";
import { getDefaultCompany } from "@/lib/db/queries";
import { buildPostcardHtml } from "@/lib/leads/postcard-art";
import { renderPostcardPreviewPage } from "@/lib/leads/postcard-preview";
import type { Dossier } from "@/lib/leads/dossier";

// Preview the owner postcard before paying to mail it. Ownership-scoped; uses the
// buyer's LIVE profile (logo, name, phone) so it matches what will print.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const buyerId = verifyBuyerSession(cookies().get(BUYER_COOKIE)?.value);
  if (!buyerId) return new NextResponse("Sign in required", { status: 401 });

  const [row] = await db
    .select()
    .from(leadUnlock)
    .where(and(eq(leadUnlock.id, params.id), eq(leadUnlock.buyer_id, buyerId)))
    .limit(1);
  if (!row) return new NextResponse("Not found", { status: 404 });
  const d = row.dossier as Dossier | null;
  if (!d) return new NextResponse("Sheet not ready", { status: 409 });

  const [me] = await db.select().from(buyer).where(eq(buyer.id, buyerId)).limit(1);
  const co = await getDefaultCompany();
  const accent = co?.brand_color || "#2f7d4f";
  const { front, back } = buildPostcardHtml(d, me ?? { company_name: "Your company" }, accent);

  return new NextResponse(renderPostcardPreviewPage(front, back), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
