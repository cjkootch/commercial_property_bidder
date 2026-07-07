import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, leadUnlock, property } from "@/lib/db/schema";
import { BUYER_COOKIE, verifyBuyerSession } from "@/lib/buyer-auth";
import { getDefaultCompany } from "@/lib/db/queries";
import { leadMaxBuyers } from "@/lib/leads/availability";
import { personalizeLetter } from "@/lib/leads/personalize";
import { renderSheetPdf } from "@/lib/leads/sheet-pdf";
import type { Dossier } from "@/lib/leads/dossier";

// On-demand PDF of a buyer's job sheet. Ownership enforced via the buyer session
// cookie. Served inline so the browser both views and offers a download — a
// consistent, fixed-layout document (no OS print dialog).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const buyerId = verifyBuyerSession(cookies().get(BUYER_COOKIE)?.value);
  if (!buyerId) return new NextResponse("Sign in required", { status: 401 });

  const [row] = await db
    .select({ unlock: leadUnlock, prop: property })
    .from(leadUnlock)
    .innerJoin(property, eq(leadUnlock.property_id, property.id))
    .where(and(eq(leadUnlock.id, params.id), eq(leadUnlock.buyer_id, buyerId)))
    .limit(1);
  if (!row) return new NextResponse("Not found", { status: 404 });

  const d = row.unlock.dossier as Dossier | null;
  if (!d) return new NextResponse("Your sheet is still being prepared.", { status: 409 });

  const [me] = await db.select().from(buyer).where(eq(buyer.id, buyerId)).limit(1);
  const co = await getDefaultCompany();
  const brand = co?.name ?? "Greenkeep";
  const accent = co?.brand_color || "#2f7d4f";
  const letter = d.intro_letter ? personalizeLetter(d.intro_letter, me ?? {}) : "";

  const pdf = await renderSheetPdf({
    dossier: d,
    brand,
    accent,
    companyName: me?.company_name ?? "your company",
    kind: row.unlock.kind,
    cap: leadMaxBuyers(),
    letter,
  });

  const filename = `${d.gk_ref}-${d.name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
