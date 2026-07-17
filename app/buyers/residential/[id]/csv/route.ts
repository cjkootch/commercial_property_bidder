import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { residentialPackage, residentialUnlock } from "@/lib/db/schema";
import { currentBuyerId } from "@/app/buyers/actions";
import { buildResidentialDossier, type ResidentialDossier } from "@/lib/residential/dossier";

// CSV export of a purchased residential report — same ownership gate as the
// report page (buyer session + unlock row).
export const dynamic = "force-dynamic";

const esc = (v: string | number | null) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const buyerId = await currentBuyerId();
  if (!buyerId) return new NextResponse("Unauthorized", { status: 401 });

  const [unlock] = await db
    .select()
    .from(residentialUnlock)
    .where(
      and(
        eq(residentialUnlock.residential_package_id, params.id),
        eq(residentialUnlock.buyer_id, buyerId)
      )
    )
    .limit(1);
  if (!unlock) return new NextResponse("Not found", { status: 404 });

  let dossier = unlock.dossier as ResidentialDossier | null;
  if (!dossier?.leads?.length) {
    dossier = await buildResidentialDossier(params.id).catch(() => null);
    // Persist like the report page does — otherwise a CSV-only buyer re-runs
    // the full build on every download.
    if (dossier?.leads?.length) {
      await db
        .update(residentialUnlock)
        .set({ dossier, updated_at: new Date() })
        .where(eq(residentialUnlock.id, unlock.id))
        .catch(() => {});
    }
  }
  if (!dossier?.leads?.length) return new NextResponse("Report not ready", { status: 503 });

  const [pkg] = await db
    .select()
    .from(residentialPackage)
    .where(eq(residentialPackage.id, params.id))
    .limit(1);

  const header = [
    "address",
    "city",
    "state",
    "zip",
    "subdivision",
    "owner",
    "absentee_owner",
    "purchase_date",
    "purchase_price",
    "county_value",
    "signal",
    "signal_date",
    "estimated_home_value",
    "lot_size_sqft",
    "year_built",
    "confidence",
    "score",
  ].join(",");
  const rows = dossier.leads.map((l) =>
    [
      esc(l.address),
      esc(l.city),
      esc(l.state),
      esc(l.zip),
      esc(l.subdivision),
      esc(l.owner ?? null),
      esc(l.absentee == null ? null : l.absentee ? "yes" : "no"),
      esc(l.purchase_date ?? null),
      esc(l.purchase_price ?? null),
      esc(l.county_value ?? null),
      esc(l.signal_type),
      esc(l.signal_date),
      esc(l.estimated_home_value),
      esc(l.lot_size_sqft ? Math.round(l.lot_size_sqft) : null),
      esc(l.year_built),
      esc(l.confidence),
      esc(l.score),
    ].join(",")
  );
  const csv = [header, ...rows].join("\n");

  const slug = (pkg?.name ?? "residential-report")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}.csv"`,
    },
  });
}
