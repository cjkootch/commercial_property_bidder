import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "../lib/db/schema";
import {
  fetchTabsDetails,
  searchTabsProjects,
  TABS_COUNTIES,
  TABS_WORK_TYPES,
} from "../lib/integrations/tabs";
import { geocodeAddress } from "../lib/integrations/geocoding";
import { fetchParcelAtPoint } from "../lib/integrations/parcel";
import { sendEmail } from "../lib/integrations/resend";
import { signBuyerUnsub } from "../lib/buyer-auth";
import { leadMaxBuyers } from "../lib/leads/availability";
import { eq } from "drizzle-orm";
import { haversineMiles } from "../lib/sourcing/criteria";

// Permit-timed sourcing: ingest big-ticket commercial construction from the
// TDLR TABS registry (public record; registration precedes occupancy by
// months — i.e., BEFORE the landscape install/maintenance is bought). Inserts
// qualified projects as 'sourced' properties tagged "TABS <number>" with the
// project value, work type, owner, and scope in notes. NO grass screen — new
// construction is dirt today; the install is the opportunity.
//
// Run:  npm run source:permits              (default: 8 leads, ≥$500k, 45 days)
//       npm run source:permits -- 5 1000000 60

const WANT = Number(process.argv[2]) || 8;
const MIN_COST = Number(process.argv[3]) || 500_000;
const SINCE_DAYS = Number(process.argv[4]) || 45;
// New builds + additions have site work; renovations usually don't.
const WORK_TYPES = new Set([9001, 9003]);

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
const db = drizzle(neon(url), { schema });

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

function icpGuess(text: string): (typeof schema.icpTypeEnum.enumValues)[number] {
  const t = text.toLowerCase();
  if (/church|worship|ministr/.test(t)) return "church";
  if (/school|isd|academy|college|campus/.test(t)) return "other";
  if (/clinic|medical|hospital|health|dental/.test(t)) return "medical";
  if (/storage/.test(t)) return "self_storage";
  if (/retail|shopping|plaza|strip/.test(t)) return "retail_strip";
  if (/office|corporate|business park/.test(t)) return "office_park";
  if (/warehouse|industrial|distribution|manufactur/.test(t)) return "industrial";
  if (/daycare|child|learning center/.test(t)) return "daycare";
  return "other";
}

async function main() {
  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found. Run `npm run db:seed` first.");

  const existing = await db.select({ name: schema.property.name }).from(schema.property);
  const have = new Set(existing.map((r) => r.name.trim().toLowerCase()));

  const since = new Date(Date.now() - SINCE_DAYS * 86400_000);
  console.log(
    `TABS registrations since ${since.toISOString().slice(0, 10)} in Harris + Montgomery, ` +
      `≥ ${usd(MIN_COST)}, new construction/additions…\n`
  );

  const all = (
    await Promise.all(
      [TABS_COUNTIES.Harris, TABS_COUNTIES.Montgomery].map((countyId) =>
        searchTabsProjects({ countyId, registeredSince: since })
      )
    )
  ).flat();

  const candidates = all
    .filter((p) => WORK_TYPES.has(p.work_type) && p.estimated_cost >= MIN_COST)
    .sort((a, b) => b.estimated_cost - a.estimated_cost);
  console.log(`  ${all.length} registrations -> ${candidates.length} big-ticket candidates\n`);

  let added = 0;
  const fresh: { city: string | null; cost: number; lat: number | null; lng: number | null }[] = [];
  for (const p of candidates) {
    if (added >= WANT) break;
    const label = p.facility_name || p.project_name;
    const name = `${label} (TABS ${p.project_number})`;
    if (have.has(name.trim().toLowerCase())) continue;

    const det = await fetchTabsDetails(p.project_id);
    if (!det?.address) {
      console.log(`  ·  no address   ${label}`);
      continue;
    }
    const coords = await geocodeAddress([det.address, det.city, det.zip, "TX"].filter(Boolean).join(", "));
    const parcel = coords ? await fetchParcelAtPoint(coords[0], coords[1]) : null;

    const startsWhen = p.est_start ? ` Est. start ${p.est_start.slice(0, 10)}.` : "";
    const notes =
      `TABS ${p.project_number}: ${TABS_WORK_TYPES[p.work_type] ?? "Construction"}, ` +
      `est. cost ${usd(p.estimated_cost)}.${startsWhen}` +
      (det.owner ? ` Owner: ${det.owner}.` : "") +
      (det.scope ? ` Scope: ${det.scope.slice(0, 300)}` : "");

    await db.insert(schema.property).values({
      company_id: co.id,
      name,
      address: det.address,
      city: det.city,
      zip: det.zip,
      lat: coords?.[1] ?? null,
      lng: coords?.[0] ?? null,
      icp_type: icpGuess(`${label} ${det.scope ?? ""}`),
      owner_org: null, // suggestion only — operator confirms (spec §9)
      source: "places",
      status: "sourced",
      parcel_geojson: parcel,
      notes,
    });
    have.add(name.trim().toLowerCase());
    added++;
    fresh.push({ city: det.city, cost: p.estimated_cost, lat: coords?.[1] ?? null, lng: coords?.[0] ?? null });
    console.log(`  ✓  ${usd(p.estimated_cost).padStart(12)}  ${label} — ${det.address}, ${det.city ?? ""}${det.owner ? ` [${det.owner}]` : ""}`);
  }

  console.log(`\nDone. Added ${added}/${WANT} permit-timed lead(s). They carry the project value/scope in notes.`);
  if (fresh.length) await notifyBuyers(fresh);
}

/**
 * New-job alerts to opted-in buyers (notify=true at signup; suppression list
 * respected). Teaser numbers only — value, area, distance from their office —
 * never an address. This is the ONE auto-send in the system, and it's the one
 * the buyer explicitly asked for.
 */
async function notifyBuyers(fresh: { city: string | null; cost: number; lat: number | null; lng: number | null }[]) {
  const base = (() => {
    const b = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    return b && !/localhost|127\.0\.0\.1/.test(b) ? b : "https://greenkeep.us";
  })();

  const buyers = await db.select().from(schema.buyer).where(eq(schema.buyer.notify, true));
  if (!buyers.length) return;
  const suppressed = new Set(
    (await db.select({ email: schema.suppression.email }).from(schema.suppression)).map((r) => r.email)
  );

  let sent = 0;
  for (const b of buyers) {
    if (suppressed.has(b.email)) continue;
    // Personalize with the nearest new job when we know their office.
    let nearest: { mi: number; item: (typeof fresh)[number] } | null = null;
    if (b.lat != null && b.lng != null) {
      for (const f of fresh) {
        if (f.lat == null || f.lng == null) continue;
        const mi = haversineMiles([b.lng, b.lat], [f.lng, f.lat]);
        if (!nearest || mi < nearest.mi) nearest = { mi, item: f };
      }
    }
    const lead = nearest?.item ?? fresh[0];
    const miTxt = nearest ? ` about ${Math.max(1, Math.round(nearest.mi))} mi from your office` : "";
    const rows = fresh
      .map((f) => `<li>${usd(f.cost)} project${f.city ? ` — ${f.city} area` : ""}</li>`)
      .join("");
    const unsubUrl = `${base}/api/unsubscribe?token=${encodeURIComponent(signBuyerUnsub(b.email))}`;
    const res = await sendEmail({
      to: b.email,
      subject: `New job near you: ${usd(lead.cost)} project${lead.city ? ` in ${lead.city}` : ""}`,
      html:
        `<p>${b.company_name} — ${fresh.length === 1 ? "a new job just opened" : `${fresh.length} new jobs just opened`}${miTxt}:</p>` +
        `<ul>${rows}</ul>` +
        `<p>Every job is capped at ${leadMaxBuyers()} companies — first come, first served. Or lock one down as an exclusive.</p>` +
        `<p><a href="${base}/buyers">See them in your dashboard</a></p>` +
        `<p style="color:#888;font-size:12px">You get these because you turned on new-job alerts. ` +
        `<a href="${unsubUrl}">Unsubscribe with one click</a> or manage alerts in <a href="${base}/buyers">your dashboard</a>.</p>`,
      tags: { kind: "buyer_alert" },
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (res.ok) sent++;
  }
  console.log(`Notified ${sent}/${buyers.length} opted-in buyer(s) of ${fresh.length} new job(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
