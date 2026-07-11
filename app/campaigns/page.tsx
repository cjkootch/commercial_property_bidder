import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyerOutreach, leadUnlock, outreachCampaign, outreachRecipient, property } from "@/lib/db/schema";
import { displayName } from "@/lib/leads/market";
import { asTrade, TRADES, type Trade } from "@/lib/leads/trades";
import { createCampaign } from "./actions";

export const dynamic = "force-dynamic";

type Blast = {
  propertyId: string;
  /** The campaign's buyer vertical (from the claim links). */
  trade: Trade;
  name: string;
  city: string | null;
  lastSent: Date | null;
  sent: number;
  skipped: number;
  bounced: number;
  delivered: number;
  opened: number;
  clicked: number;
  /** Sequence step 2 (the 48h follow-up): sent / opened / clicked. */
  nudged: number;
  nudgeOpened: number;
  nudgeClicked: number;
  claims: number;
};

// Automated lead-offer blasts (buyer prospecting), grouped per lead + trade
// (the same property can be campaigned to several trades). Funnel counts come
// from Resend webhook events; claims from lead_unlock.
async function loadBlasts(): Promise<Blast[]> {
  const rows = await db
    .select({
      property_id: buyerOutreach.property_id,
      claim_url: buyerOutreach.claim_url,
      status: buyerOutreach.status,
      sent_at: buyerOutreach.sent_at,
      delivered_at: buyerOutreach.delivered_at,
      opened_at: buyerOutreach.opened_at,
      clicked_at: buyerOutreach.clicked_at,
      nudged_at: buyerOutreach.nudged_at,
      nudge_opened_at: buyerOutreach.nudge_opened_at,
      nudge_clicked_at: buyerOutreach.nudge_clicked_at,
    })
    .from(buyerOutreach)
    .orderBy(desc(buyerOutreach.created_at))
    // Window must comfortably exceed total send history — a short window
    // makes old blasts show partial sends against full claim counts.
    .limit(10000);

  const byProp = new Map<string, Blast>();
  for (const r of rows) {
    if (!r.property_id) continue;
    const trade = asTrade(r.claim_url?.match(/[?&]trade=([a-z]+)/)?.[1]);
    const key = `${r.property_id}:${trade}`;
    let b = byProp.get(key);
    if (!b) {
      b = {
        propertyId: r.property_id,
        trade,
        name: "",
        city: null,
        lastSent: null,
        sent: 0,
        skipped: 0,
        bounced: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        nudged: 0,
        nudgeOpened: 0,
        nudgeClicked: 0,
        claims: 0,
      };
      byProp.set(key, b);
    }
    if (r.status === "sent" || r.status === "bounced") b.sent++;
    if (r.status === "skipped") b.skipped++;
    if (r.status === "bounced") b.bounced++;
    if (r.delivered_at) b.delivered++;
    if (r.opened_at) b.opened++;
    if (r.clicked_at) b.clicked++;
    if (r.nudged_at) b.nudged++;
    if (r.nudge_opened_at) b.nudgeOpened++;
    if (r.nudge_clicked_at) b.nudgeClicked++;
    if (r.sent_at && (!b.lastSent || r.sent_at > b.lastSent)) b.lastSent = r.sent_at;
  }
  const ids = [...new Set([...byProp.values()].map((b) => b.propertyId))];
  if (!ids.length) return [];

  const props = await db
    .select({ id: property.id, name: property.name, city: property.city })
    .from(property)
    .where(inArray(property.id, ids));
  for (const p of props) {
    for (const b of byProp.values()) {
      if (b.propertyId === p.id) {
        b.name = displayName(p.name);
        b.city = p.city;
      }
    }
  }
  // Claims are counted per trade — each blast row shows ITS vertical's claims.
  const unlocks = await db
    .select({ property_id: leadUnlock.property_id, trade: leadUnlock.trade })
    .from(leadUnlock)
    .where(inArray(leadUnlock.property_id, ids));
  for (const u of unlocks) {
    const b = byProp.get(`${u.property_id}:${asTrade(u.trade)}`);
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

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: { trade?: string; sort?: string };
}) {
  const all = await loadBlasts();
  // ?trade= filters to one vertical; ?sort=trade groups by industry.
  const tradeFilter = searchParams.trade && searchParams.trade !== "all" ? asTrade(searchParams.trade) : null;
  const blasts = (tradeFilter ? all.filter((b) => b.trade === tradeFilter) : all).slice();
  if (searchParams.sort === "trade") {
    blasts.sort(
      (a, b) =>
        a.trade.localeCompare(b.trade) || (b.lastSent?.getTime() ?? 0) - (a.lastSent?.getTime() ?? 0)
    );
  } else if (searchParams.sort === "city") {
    blasts.sort(
      (a, b) =>
        (a.city ?? "zzz").localeCompare(b.city ?? "zzz") ||
        (b.lastSent?.getTime() ?? 0) - (a.lastSent?.getTime() ?? 0)
    );
  }
  const tradeCounts = new Map<Trade, number>();
  for (const b of all) tradeCounts.set(b.trade, (tradeCounts.get(b.trade) ?? 0) + 1);
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
          {/* Industry filter chips + counts. */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <Link
              href="/campaigns"
              className={`rounded-full px-2.5 py-1 font-semibold ${!tradeFilter ? "bg-brand text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50"}`}
            >
              All ({all.length})
            </Link>
            {[...tradeCounts.entries()].map(([t, n]) => (
              <Link
                key={t}
                href={`/campaigns?trade=${t}`}
                className={`rounded-full px-2.5 py-1 font-semibold ${tradeFilter === t ? "bg-brand text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50"}`}
              >
                {TRADES[t].label} ({n})
              </Link>
            ))}
          </div>
          <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-2.5 font-medium">Lead</th>
                  <th className="px-3 py-2.5 font-medium">
                    <Link
                      href={searchParams.sort === "trade" ? `/campaigns${tradeFilter ? `?trade=${tradeFilter}` : ""}` : `/campaigns?${tradeFilter ? `trade=${tradeFilter}&` : ""}sort=trade`}
                      className="hover:text-gray-600"
                      title="Sort by industry"
                    >
                      Industry {searchParams.sort === "trade" ? "\u2193" : "\u2195"}
                    </Link>
                  </th>
                  <th className="px-3 py-2.5 font-medium">
                    <Link
                      href={searchParams.sort === "city" ? `/campaigns${tradeFilter ? `?trade=${tradeFilter}` : ""}` : `/campaigns?${tradeFilter ? `trade=${tradeFilter}&` : ""}sort=city`}
                      className="hover:text-gray-600"
                      title="Sort by city"
                    >
                      City {searchParams.sort === "city" ? "\u2193" : "\u2195"}
                    </Link>
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium">Sent</th>
                  <th className="px-3 py-2.5 text-right font-medium">Delivered</th>
                  <th className="px-3 py-2.5 text-right font-medium">Opened</th>
                  <th className="px-3 py-2.5 text-right font-medium">Clicked</th>
                  <th className="px-3 py-2.5 text-right font-medium" title="The 48h follow-up step: sent / opened / clicked">Follow-up</th>
                  <th className="px-3 py-2.5 text-right font-medium">Bounced</th>
                  <th className="px-3 py-2.5 text-right font-medium">No email</th>
                  <th className="px-3 py-2.5 text-right font-medium">Claims</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {blasts.map((b) => (
                  <tr key={`${b.propertyId}:${b.trade}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/campaigns/prospecting/${b.propertyId}?trade=${b.trade}`}
                        className="font-medium text-gray-900 hover:text-brand"
                      >
                        {b.name || "(deleted lead)"}
                      </Link>
                      <div className="text-xs text-gray-400">
                        {b.city ?? ""}
                        {b.lastSent
                          ? `${b.city ? " · " : ""}${b.lastSent.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" })}`
                          : ""}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-bold text-brand">
                        {TRADES[b.trade].label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-gray-600">{b.city ?? "\u2014"}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{b.sent}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{b.delivered}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{b.opened}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{b.clicked}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-600">
                      {b.nudged ? `${b.nudged} · ${b.nudgeOpened}o · ${b.nudgeClicked}c` : "\u2014"}
                    </td>
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
