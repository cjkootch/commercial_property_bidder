import { isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, leadUnlock, property } from "@/lib/db/schema";

type Buyer = typeof buyer.$inferSelect;
import { displayName } from "@/lib/leads/market";
import { haversineMiles } from "@/lib/sourcing/criteria";
import { startFirstLookCheckout } from "./actions";
import { firstLookPriceCents } from "@/lib/leads/subscription";

/** Contract-anniversary radar: properties near this buyer whose contracts
 *  re-bid within 90 days (sold ~a year ago; the renewal cron reopens them at
 *  the anniversary). Members see the list; free accounts see the count and
 *  the First Look pitch — this is the subscription's second pillar. */
export async function RenewalRadar({ me }: { me: Buyer }) {
  if (me.lat == null || me.lng == null) return null;

  const [unlocks, props] = await Promise.all([
    db
      .select({
        property_id: leadUnlock.property_id,
        cycle: leadUnlock.cycle,
        created_at: leadUnlock.created_at,
      })
      .from(leadUnlock),
    db
      .select({
        id: property.id,
        name: property.name,
        city: property.city,
        lat: property.lat,
        lng: property.lng,
        sale_cycle: property.sale_cycle,
        archived_at: property.archived_at,
      })
      .from(property)
      .where(isNotNull(property.lat)),
  ]);

  // First sale of the CURRENT cycle anchors the anniversary the renewal cron
  // will reopen spots on.
  const firstSold = new Map<string, number>();
  const cycleById = new Map(props.map((p) => [p.id, p.sale_cycle]));
  for (const u of unlocks) {
    if (u.cycle !== (cycleById.get(u.property_id) ?? 0)) continue;
    const t = u.created_at.getTime();
    const prev = firstSold.get(u.property_id);
    if (prev == null || t < prev) firstSold.set(u.property_id, t);
  }

  const now = Date.now();
  const YEAR = 365 * 86_400_000;
  const radius = me.service_radius_mi;
  const upcoming = props
    .filter((p) => !p.archived_at && firstSold.has(p.id) && p.lat != null && p.lng != null)
    .map((p) => {
      const anniversary = firstSold.get(p.id)! + YEAR;
      const miles = haversineMiles([me.lng!, me.lat!], [p.lng!, p.lat!]);
      return { ...p, anniversary, miles };
    })
    .filter(
      (p) => p.anniversary > now && p.anniversary <= now + 90 * 86_400_000 && p.miles <= radius
    )
    .sort((a, b) => a.anniversary - b.anniversary)
    .slice(0, 5);

  if (upcoming.length === 0) return null;

  if (me.plan !== "first_look") {
    return (
      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">
          📡 Renewal radar
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          <span className="font-bold text-gray-900">{upcoming.length}</span>{" "}
          {upcoming.length === 1 ? "property" : "properties"} inside your service area re-bid{" "}
          {upcoming.length === 1 ? "its contract" : "their contracts"} in the next 90 days —
          fresh spots open at each anniversary, and First Look members see them first.
        </p>
        <form action={startFirstLookCheckout} className="mt-3">
          <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
            Get First Look — ${Math.round(firstLookPriceCents() / 100)}/mo
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">
          📡 Renewal radar
        </h2>
        <span className="text-xs text-gray-400">First Look member view</span>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Contracts near you re-bidding soon — fresh spots open at each anniversary. Be the bid
        that's already waiting.
      </p>
      <ul className="mt-3 divide-y divide-gray-100">
        {upcoming.map((p) => {
          const weeks = Math.max(1, Math.round((p.anniversary - now) / (7 * 86_400_000)));
          return (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 truncate font-medium text-gray-800">
                {displayName(p.name)}
              </span>
              <span className="shrink-0 text-xs text-gray-500">
                {p.city ?? "nearby"} · {Math.round(p.miles)} mi · re-bids in ~{weeks}w
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
