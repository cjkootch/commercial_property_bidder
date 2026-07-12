import Link from "next/link";
import { and, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { property, leadUnlock } from "@/lib/db/schema";
import { leadKind, displayName, type LeadKind } from "@/lib/leads/market";
import { marketForCoords, MARKETS } from "@/lib/markets";
import { TRADES, asTrade, type Trade } from "@/lib/leads/trades";
import { leadMaxBuyers } from "@/lib/leads/availability";
import { usd } from "@/lib/format";

// Operator "Opportunities" explorer: one board that summarizes live lead
// inventory by LOCATION and by FEED, and drills into each opportunity faceted
// by metro / feed (lead kind) / trade / status. Reads the same data the shelf
// sells from — no new plumbing, a new lens over marketForCoords + leadKind +
// per-trade availability.
export const dynamic = "force-dynamic";

const MARKER = /\((TABS|HCAD|STP|H311|TABC|TAX|RFP|BLD|CODE) [^)]+\)$/;

const KIND_LABEL: Record<LeadKind, string> = {
  construction: "Construction / permits",
  transfer: "Ownership transfer",
  opening: "New business",
  violation: "Code violation",
  distress: "Tax / distress",
  rfp: "Public RFP",
};
const KIND_ORDER: LeadKind[] = [
  "construction",
  "violation",
  "transfer",
  "opening",
  "distress",
  "rfp",
];

type Params = { metro?: string; feed?: string; trade?: string; status?: string };

/** Build a querystring that flips one facet (same value = clear it). */
function facetHref(cur: Params, key: keyof Params, val: string | null): string {
  const next: Params = { ...cur };
  if (val == null || cur[key] === val) delete next[key];
  else next[key] = val;
  const qs = new URLSearchParams(next as Record<string, string>).toString();
  return qs ? `/opportunities?${qs}` : "/opportunities";
}

export default async function OpportunitiesPage({ searchParams }: { searchParams: Params }) {
  const cap = leadMaxBuyers();
  const cur: Params = {
    metro: searchParams.metro,
    feed: searchParams.feed,
    trade: searchParams.trade,
    status: searchParams.status,
  };

  const [props, unlocks] = await Promise.all([
    db
      .select({
        id: property.id,
        name: property.name,
        city: property.city,
        lat: property.lat,
        lng: property.lng,
        teaser: property.lead_teaser,
        hasParcel: sql<boolean>`${property.parcel_geojson} is not null`,
      })
      .from(property)
      .where(and(isNull(property.archived_at), isNull(property.lead_exported_at))),
    db
      .select({ pid: leadUnlock.property_id, trade: leadUnlock.trade, kind: leadUnlock.kind })
      .from(leadUnlock),
  ]);

  // Per-property, per-trade spots sold (+ whether a trade is held exclusive).
  const spots = new Map<string, Partial<Record<Trade, { n: number; excl: boolean }>>>();
  for (const u of unlocks) {
    const t = asTrade(u.trade);
    const e = spots.get(u.pid) ?? {};
    const cell = e[t] ?? { n: 0, excl: false };
    cell.n++;
    if (u.kind === "exclusive") cell.excl = true;
    e[t] = cell;
    spots.set(u.pid, e);
  }

  // Shape each live lead: metro + feed(kind) + which trades are still open.
  const opps = props
    .filter((p) => MARKER.test(p.name) && (p.hasParcel || leadKind(p.name) === "rfp"))
    .map((p) => {
      const kind = leadKind(p.name);
      const mkt = p.lat != null && p.lng != null ? marketForCoords(p.lat, p.lng) : null;
      const t = (p.teaser ?? null) as { annual_lo?: number; annual_hi?: number } | null;
      const relevant = Object.values(TRADES).filter((td) => td.relevant(kind));
      const openTrades = relevant.filter((td) => {
        const cell = spots.get(p.id)?.[td.key];
        return !cell?.excl && (cell?.n ?? 0) < cap;
      });
      return {
        id: p.id,
        name: displayName(p.name),
        city: p.city,
        kind,
        metroKey: mkt?.key ?? null,
        metroLabel: mkt?.label ?? "Unknown metro",
        value: t?.annual_hi ?? t?.annual_lo ?? null,
        relevantKeys: new Set(relevant.map((td) => td.key)),
        openKeys: new Set(openTrades.map((td) => td.key)),
      };
    });

  // Location + feed summaries (over ALL opportunities, as quick filters).
  const byMetro = new Map<string, number>();
  const byFeed = new Map<LeadKind, number>();
  for (const o of opps) {
    byMetro.set(o.metroKey ?? "unknown", (byMetro.get(o.metroKey ?? "unknown") ?? 0) + 1);
    byFeed.set(o.kind, (byFeed.get(o.kind) ?? 0) + 1);
  }

  // Apply the active facets.
  const filtered = opps
    .filter((o) => !cur.metro || o.metroKey === cur.metro)
    .filter((o) => !cur.feed || o.kind === cur.feed)
    .filter((o) => !cur.trade || o.relevantKeys.has(cur.trade as Trade))
    .filter((o) => {
      if (!cur.status) return true;
      const open = cur.trade ? o.openKeys.has(cur.trade as Trade) : o.openKeys.size > 0;
      return cur.status === "open" ? open : !open;
    })
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const activeMetros = Object.values(MARKETS).filter((m) => byMetro.get(m.key));
  const activeFeeds = KIND_ORDER.filter((k) => byFeed.get(k));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Opportunities</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Every live lead on the shelf, by location and feed — filter to drill in.
        </p>
      </div>

      {/* Location + feed summary tiles (click to filter). */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SummaryCard title="By location">
          {activeMetros.length === 0 ? (
            <Empty>No located leads yet.</Empty>
          ) : (
            activeMetros.map((m) => (
              <Tile
                key={m.key}
                label={m.label}
                count={byMetro.get(m.key) ?? 0}
                href={facetHref(cur, "metro", m.key)}
                active={cur.metro === m.key}
              />
            ))
          )}
        </SummaryCard>
        <SummaryCard title="By feed">
          {activeFeeds.length === 0 ? (
            <Empty>No leads yet.</Empty>
          ) : (
            activeFeeds.map((k) => (
              <Tile
                key={k}
                label={KIND_LABEL[k]}
                count={byFeed.get(k) ?? 0}
                href={facetHref(cur, "feed", k)}
                active={cur.feed === k}
              />
            ))
          )}
        </SummaryCard>
      </div>

      {/* Facet bar: trade + status (metro/feed set from the tiles above). */}
      <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
        <FacetRow label="Trade">
          <Chip href={facetHref(cur, "trade", null)} active={!cur.trade}>
            All trades
          </Chip>
          {Object.values(TRADES).map((t) => (
            <Chip key={t.key} href={facetHref(cur, "trade", t.key)} active={cur.trade === t.key}>
              {t.label}
            </Chip>
          ))}
        </FacetRow>
        <FacetRow label="Status">
          <Chip href={facetHref(cur, "status", null)} active={!cur.status}>
            Any
          </Chip>
          <Chip href={facetHref(cur, "status", "open")} active={cur.status === "open"}>
            Open
          </Chip>
          <Chip href={facetHref(cur, "status", "soldout")} active={cur.status === "soldout"}>
            Sold out
          </Chip>
        </FacetRow>
        {(cur.metro || cur.feed || cur.trade || cur.status) && (
          <div className="pt-1">
            <Link href="/opportunities" className="text-xs font-semibold text-brand hover:underline">
              Clear all filters
            </Link>
          </div>
        )}
      </div>

      {/* The drill-down table. */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {filtered.length} {filtered.length === 1 ? "opportunity" : "opportunities"}
        </div>
        {filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-500">No opportunities match these filters.</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Property</th>
                <th className="px-4 py-2 font-medium">Location</th>
                <th className="px-4 py-2 font-medium">Feed</th>
                <th className="px-4 py-2 text-right font-medium">Value</th>
                <th className="px-4 py-2 font-medium">Open trades</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <Link href={`/properties/${o.id}`} className="font-medium text-brand hover:underline">
                      {o.name}
                    </Link>
                    {o.city ? <span className="ml-1 text-gray-400">· {o.city}</span> : null}
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">{o.metroLabel}</td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                      {KIND_LABEL[o.kind]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {o.value != null ? `${usd(o.value, { cents: false })}/yr` : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {o.openKeys.size === 0 ? (
                      <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                        Sold out
                      </span>
                    ) : (
                      <span className="text-xs text-gray-600">
                        <span className="font-semibold text-green-700">{o.openKeys.size}</span> of{" "}
                        {o.relevantKeys.size} open
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">{title}</h2>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function Tile({
  label,
  count,
  href,
  active,
}: {
  label: string;
  count: number;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-lg border px-3 py-2 transition ${
        active ? "border-brand bg-brand/5" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
      }`}
    >
      <div className={`text-xl font-semibold tabular-nums ${active ? "text-brand" : "text-gray-900"}`}>
        {count}
      </div>
      <div className="text-xs text-gray-500">{label}</div>
    </Link>
  );
}

function FacetRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-12 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
        active ? "bg-brand text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      }`}
    >
      {children}
    </Link>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-400">{children}</p>;
}
