import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyerOutreach, leadUnlock, outreachCampaign, outreachRecipient, property } from "@/lib/db/schema";
import { displayName } from "@/lib/leads/market";
import { createCampaign } from "./actions";

export const dynamic = "force-dynamic";

type Blast = {
  propertyId: string;
  name: string;
  city: string | null;
  lastSent: Date | null;
  sent: number;
  skipped: number;
  bounced: number;
  delivered: number;
  opened: number;
  clicked: number;
  claims: number;
};

// Automated lead-offer blasts (buyer prospecting), grouped per lead. Funnel
// counts come from Resend webhook events; claims from lead_unlock.
async function loadBlasts(): Promise<Blast[]> {
  const rows = await db
    .select({
      property_id: buyerOutreach.property_id,
      status: buyerOutreach.status,
      sent_at: buyerOutreach.sent_at,
      delivered_at: buyerOutreach.delivered_at,
      opened_at: buyerOutreach.opened_at,
      clicked_at: buyerOutreach.clicked_at,
    })
    .from(buyerOutreach)
    .orderBy(desc(buyerOutreach.created_at))
    .limit(2000);

  const byProp = new Map<string, Blast>();
  for (const r of rows) {
    if (!r.property_id) continue;
    let b = byProp.get(r.property_id);
    if (!b) {
      b = {
        propertyId: r.property_id,
        name: "",
        city: null,
        lastSent: null,
        sent: 0,
        skipped: 0,
        bounced: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        claims: 0,
      };
      byProp.set(r.property_id, b);
    }
    if (r.status === "sent" || r.status === "bounced") b.sent++;
    if (r.status === "skipped") b.skipped++;
    if (r.status === "bounced") b.bounced++;
    if (r.delivered_at) b.delivered++;
    if (r.opened_at) b.opened++;
    if (r.clicked_at) b.clicked++;
    if (r.sent_at && (!b.lastSent || r.sent_at > b.lastSent)) b.lastSent = r.sent_at;
  }
  const ids = [...byProp.keys()];
  if (!ids.length) return [];

  const props = await db
    .select({ id: property.id, name: property.name, city: property.city })
    .from(property)
    .where(inArray(property.id, ids));
  for (const p of props) {
    const b = byProp.get(p.id);
    if (b) {
      b.name = displayName(p.name);
      b.city = p.city;
    }
  }
  const unlocks = await db
    .select({ property_id: leadUnlock.property_id })
    .from(leadUnlock)
    .where(inArray(leadUnlock.property_id, ids));
  for (const u of unlocks) {
    const b = byProp.get(u.property_id);
    if (b) b.claims++;
  }
  return [...byProp.values()].sort(
    (a, b) => (b.lastSent?.getTime() ?? 0) - (a.lastSent?.getTime() ?? 0)
  );
}

const STAGE_LABEL: Record<string, string> = {
  properties: "Choosing properties",
  recipients: "Reviewing companies",
  messaging: "Reviewing messaging",
  ready: "Ready to send",
  sent: "Sent",
  canceled: "Canceled",
};

export default async function CampaignsPage() {
  const blasts = await loadBlasts();
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

      {blasts.length > 0 ? (
        <div className="mt-8">
          <h2 className="text-lg font-semibold">Lead-offer blasts</h2>
          <p className="mt-1 text-sm text-gray-500">
            Automated offers to landscaping companies. Delivered / opened / clicked come from
            Resend events; claims are profiles created off the email.
          </p>
          <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-2.5 font-medium">Lead</th>
                  <th className="px-3 py-2.5 text-right font-medium">Sent</th>
                  <th className="px-3 py-2.5 text-right font-medium">Delivered</th>
                  <th className="px-3 py-2.5 text-right font-medium">Opened</th>
                  <th className="px-3 py-2.5 text-right font-medium">Clicked</th>
                  <th className="px-3 py-2.5 text-right font-medium">Bounced</th>
                  <th className="px-3 py-2.5 text-right font-medium">No email</th>
                  <th className="px-3 py-2.5 text-right font-medium">Claims</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {blasts.map((b) => (
                  <tr key={b.propertyId} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/campaigns/prospecting/${b.propertyId}`}
                        className="font-medium text-gray-900 hover:text-brand"
                      >
                        {b.name || "(deleted lead)"}
                      </Link>
                      <div className="text-xs text-gray-400">
                        {b.city ?? ""}
                        {b.lastSent
                          ? `${b.city ? " · " : ""}${b.lastSent.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                          : ""}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{b.sent}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{b.delivered}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{b.opened}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{b.clicked}</td>
                    <td
                      className={`px-3 py-3 text-right tabular-nums ${b.bounced ? "font-medium text-red-600" : ""}`}
                    >
                      {b.bounced}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-400">{b.skipped}</td>
                    <td
                      className={`px-3 py-3 text-right tabular-nums ${b.claims ? "font-semibold text-green-700" : ""}`}
                    >
                      {b.claims}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {blasts.length > 0 ? <h2 className="mt-8 text-lg font-semibold">Owner outreach</h2> : null}
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
