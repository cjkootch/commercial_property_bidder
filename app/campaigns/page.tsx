import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { outreachCampaign, outreachRecipient } from "@/lib/db/schema";
import { createCampaign } from "./actions";

export const dynamic = "force-dynamic";

const STAGE_LABEL: Record<string, string> = {
  properties: "Choosing properties",
  recipients: "Reviewing companies",
  messaging: "Reviewing messaging",
  ready: "Ready to send",
  sent: "Sent",
  canceled: "Canceled",
};

export default async function CampaignsPage() {
  const campaigns = await db.select().from(outreachCampaign).orderBy(desc(outreachCampaign.created_at)).limit(100);
  const counts = new Map<string, { total: number; sent: number }>();
  for (const c of campaigns) {
    const recips = await db
      .select({ status: outreachRecipient.status })
      .from(outreachRecipient)
      .where(eq(outreachRecipient.campaign_id, c.id));
    counts.set(c.id, { total: recips.length, sent: recips.filter((r) => r.status === "sent").length });
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Campaigns</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review each opportunity blast before it sends: properties → companies → messaging →
            send.
          </p>
        </div>
        <form action={createCampaign}>
          <button className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
            + New campaign
          </button>
        </form>
      </div>

      {campaigns.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          No campaigns yet. Start one — you approve every step before anything goes out.
        </p>
      ) : (
        <div className="mt-6 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {campaigns.map((c) => {
            const n = counts.get(c.id) ?? { total: 0, sent: 0 };
            return (
              <Link
                key={c.id}
                href={`/campaigns/${c.id}`}
                className="flex items-center justify-between px-5 py-4 hover:bg-gray-50"
              >
                <div>
                  <div className="font-medium text-gray-900">{c.label}</div>
                  <div className="mt-0.5 text-sm text-gray-500">
                    {(c.property_ids ?? []).length} propert
                    {(c.property_ids ?? []).length === 1 ? "y" : "ies"} · {n.total} compan
                    {n.total === 1 ? "y" : "ies"}
                    {c.stage === "sent" ? ` · ${n.sent} sent` : ""}
                  </div>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    c.stage === "sent"
                      ? "bg-green-100 text-green-800"
                      : c.stage === "canceled"
                        ? "bg-gray-100 text-gray-500"
                        : c.stage === "ready"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-brand/10 text-brand"
                  }`}
                >
                  {STAGE_LABEL[c.stage] ?? c.stage}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
