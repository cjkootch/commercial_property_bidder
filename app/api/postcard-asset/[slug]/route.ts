import { NextResponse } from "next/server";
import { getProspectBySlug } from "@/lib/db/queries";
import type { DossierAerial } from "@/lib/leads/dossier";

// Serves a prospect's aerial image (the one cached at scan time) as a real
// JPEG at a short, unguessable URL — so the Lob postcard can reference it by URL
// instead of embedding a base64 data URL (Lob caps inline HTML at 10k chars).
// Public (whitelisted in middleware); the slug is the unguessable proposal_slug.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const data = await getProspectBySlug(params.slug);
  const aerial = data?.prospect?.aerial as DossierAerial | null;
  const image = aerial?.image;
  if (!image?.startsWith("data:image")) {
    return new NextResponse("Not found", { status: 404 });
  }
  const comma = image.indexOf(",");
  const meta = image.slice(5, comma); // e.g. "image/jpeg;base64"
  const contentType = meta.split(";")[0] || "image/jpeg";
  const bytes = Buffer.from(image.slice(comma + 1), "base64");
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
