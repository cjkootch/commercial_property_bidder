// Permit-timed lead sourcing, shared by the CLI script (scripts/source-permits)
// and the weekly cron (/api/cron/permits): ingest big-ticket commercial
// construction from the TDLR TABS registry, size a marketplace teaser, and
// alert opted-in buyers. Alert emails are the system's one auto-send — buyers
// explicitly opted in at signup and every email carries one-click unsubscribe.

import { eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import {
  fetchTabsDetails,
  searchTabsProjects,
  TABS_COUNTIES,
  TABS_WORK_TYPES,
} from "../integrations/tabs";
import { geocodeAddress } from "../integrations/geocoding";
import { fetchParcelAtPoint } from "../integrations/parcel";
import { sendEmail } from "../integrations/resend";
import { sizeLead } from "../leads/sizing";
import { getActiveConfig, toEngineConfig } from "../db/queries";
import { signBuyerUnsub } from "../buyer-auth";
import { leadMaxBuyers } from "../leads/availability";
import { haversineMiles } from "../sourcing/criteria";
import type { ParcelResult } from "../geo/types";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
// New builds + additions have site work; renovations usually don't.
const WORK_TYPES = new Set([9001, 9003]);

export function icpGuess(text: string): (typeof schema.icpTypeEnum.enumValues)[number] {
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

export type PermitRunSummary = {
  scanned: number;
  candidates: number;
  added: number;
  notified: number;
  log: string[];
};

export async function runPermitSourcing(opts?: {
  want?: number;
  minCost?: number;
  sinceDays?: number;
  /** County names from TABS_COUNTIES; defaults to all configured. */
  counties?: (keyof typeof TABS_COUNTIES)[];
}): Promise<PermitRunSummary> {
  const want = opts?.want ?? 8;
  const minCost = opts?.minCost ?? 500_000;
  const sinceDays = opts?.sinceDays ?? 45;
  const counties = opts?.counties ?? (Object.keys(TABS_COUNTIES) as (keyof typeof TABS_COUNTIES)[]);
  const log: string[] = [];

  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found. Run `npm run db:seed` first.");

  const existing = await db.select({ name: schema.property.name }).from(schema.property);
  const have = new Set(existing.map((r) => r.name.trim().toLowerCase()));

  const since = new Date(Date.now() - sinceDays * 86400_000);
  const all = (
    await Promise.all(
      counties.map((c) => searchTabsProjects({ countyId: TABS_COUNTIES[c], registeredSince: since }))
    )
  ).flat();

  const candidates = all
    .filter((p) => WORK_TYPES.has(p.work_type) && p.estimated_cost >= minCost)
    .sort((a, b) => b.estimated_cost - a.estimated_cost);
  log.push(`${all.length} registrations -> ${candidates.length} big-ticket candidates (${counties.join(", ")})`);

  let added = 0;
  const fresh: { city: string | null; cost: number; lat: number | null; lng: number | null }[] = [];
  for (const p of candidates) {
    if (added >= want) break;
    const label = p.facility_name || p.project_name;
    const name = `${label} (TABS ${p.project_number})`;
    if (have.has(name.trim().toLowerCase())) continue;

    const det = await fetchTabsDetails(p.project_id);
    if (!det?.address) {
      log.push(`no address: ${label}`);
      continue;
    }
    const coords = await geocodeAddress([det.address, det.city, det.zip, "TX"].filter(Boolean).join(", "));
    const parcel = coords ? await fetchParcelAtPoint(coords[0], coords[1]) : null;

    const startsWhen = p.est_start ? ` Est. start ${p.est_start.slice(0, 10)}.` : "";
    // Completion drives the timing/urgency lead-score signal.
    const doneWhen = p.est_end ? ` Est. completion ${p.est_end.slice(0, 10)}.` : "";
    const notes =
      `TABS ${p.project_number}: ${TABS_WORK_TYPES[p.work_type] ?? "Construction"}, ` +
      `est. cost ${usd(p.estimated_cost)}.${startsWhen}${doneWhen}` +
      (det.owner ? ` Owner: ${det.owner}.` : "") +
      (det.scope ? ` Scope: ${det.scope.slice(0, 300)}` : "");

    // Marketplace teaser: size once so dashboard cards show contract value
    // without per-view imagery spend.
    let teaser: Record<string, unknown> | null = null;
    if (parcel && process.env.MAPBOX_API) {
      try {
        const cfgRow = await getActiveConfig(co.id);
        if (cfgRow) {
          const sz = await sizeLead(parcel as ParcelResult, process.env.MAPBOX_API, toEngineConfig(cfgRow));
          teaser = {
            annual_lo: sz.annual_lo,
            annual_hi: sz.annual_hi,
            turf_sqft: sz.turf_sqft,
            projected: sz.projected,
            computed_at: new Date().toISOString().slice(0, 10),
          };
        }
      } catch {
        /* teaser optional */
      }
    }

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
      lead_teaser: teaser,
      notes,
    });
    have.add(name.trim().toLowerCase());
    added++;
    fresh.push({ city: det.city, cost: p.estimated_cost, lat: coords?.[1] ?? null, lng: coords?.[0] ?? null });
    log.push(`added ${usd(p.estimated_cost)} ${label} — ${det.city ?? ""}`);
  }

  const notified = fresh.length ? await notifyBuyersOfFresh(fresh) : 0;
  return { scanned: all.length, candidates: candidates.length, added, notified, log };
}

/** New-job alerts to opted-in buyers (teaser numbers only — never an address). */
export async function notifyBuyersOfFresh(
  fresh: { city: string | null; cost: number; lat: number | null; lng: number | null }[]
): Promise<number> {
  const base = (() => {
    const b = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    return b && !/localhost|127\.0\.0\.1/.test(b) ? b : "https://greenkeep.us";
  })();

  const buyers = await db.select().from(schema.buyer).where(eq(schema.buyer.notify, true));
  if (!buyers.length) return 0;
  const suppressed = new Set(
    (await db.select({ email: schema.suppression.email }).from(schema.suppression)).map((r) => r.email)
  );

  let sent = 0;
  for (const b of buyers) {
    if (suppressed.has(b.email)) continue;
    let nearest: { mi: number; item: (typeof fresh)[number] } | null = null;
    if (b.lat != null && b.lng != null) {
      for (const f of fresh) {
        if (f.lat == null || f.lng == null) continue;
        const mi = haversineMiles([b.lng, b.lat], [f.lng, f.lat]);
        if (!nearest || mi < nearest.mi) nearest = { mi, item: f };
      }
    }
    // Respect the buyer's service radius (+ a cushion): if we know their
    // location and NOTHING new landed near enough, don't email them noise.
    // Buyers with no location still get alerts (we can't filter them).
    if (b.lat != null && b.lng != null) {
      const reach = b.service_radius_mi + Math.max(15, Math.round(b.service_radius_mi * 0.4));
      if (!nearest || nearest.mi > reach) continue;
    }
    const lead = nearest?.item ?? fresh[0];
    const miTxt = nearest ? ` about ${Math.max(1, Math.round(nearest.mi))} mi from your office` : "";
    // Only list jobs actually within reach (or all, if we can't place them).
    const reach = b.lat != null && b.lng != null ? b.service_radius_mi + Math.max(15, Math.round(b.service_radius_mi * 0.4)) : Infinity;
    const shown = fresh.filter(
      (f) => b.lat == null || b.lng == null || f.lat == null || f.lng == null || haversineMiles([b.lng!, b.lat!], [f.lng, f.lat]) <= reach
    );
    const rows = (shown.length ? shown : [lead])
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
  return sent;
}
