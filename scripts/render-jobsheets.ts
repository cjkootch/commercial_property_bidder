import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { mkdir, writeFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { desc, like } from "drizzle-orm";
import { chromium } from "playwright";
import * as schema from "../lib/db/schema";
import { fetchParcelTile, estimateServiceableArea } from "../lib/integrations/imagery";
import { getActiveConfig, toEngineConfig } from "../lib/db/queries";
import { computePricing } from "../lib/pricing/engine";
import { M2_TO_SQFT } from "../lib/geo/area";
import { findTabsByNumber, fetchTabsDetails } from "../lib/integrations/tabs";
import { findContact } from "../lib/integrations/contact";
import { haversineMiles } from "../lib/sourcing/criteria";
import area from "@turf/area";
import type { ParcelResult } from "../lib/geo/types";

// Job sheets + teasers for the permit-lead data product. For every TABS-tagged
// property: measure (RGB veg; parcel-fraction fallback on raw dirt), size the
// MAINTENANCE account with the pricing engine (in-memory — nothing persisted,
// the sales pipeline stays clean), and render:
//   jobsheets/<n>-sheet.png   — the paid deliverable: aerial + detected-grounds
//                               overlay, metrics, annual value, crew sizing,
//                               project scope/owner/timing
//   jobsheets/<n>-teaser.txt  — the email tease: value + size + timing + area,
//                               NO address/name/owner (pay to unlock)
//
// Run:  npm run jobsheets            (all TABS leads, max 10)
//       npm run jobsheets -- 3

const MAX = Number(process.argv[2]) || 10;
const W = 1650; // 11x8.5" landscape @150dpi — email/PDF friendly
const H = 1275;

const url = process.env.DATABASE_URL;
const token = process.env.MAPBOX_API ?? null;
if (!url) throw new Error("DATABASE_URL is not set.");
if (!token) throw new Error("MAPBOX_API is not set.");
const db = drizzle(neon(url), { schema });

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const roundTo = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function note(tabsNotes: string | null, key: string): string | null {
  // notes format (source-permits): "TABS <num>: <type>, est. cost $X. Est. start D. Owner: O. Scope: S"
  if (!tabsNotes) return null;
  const m: Record<string, RegExp> = {
    number: /TABS (\S+):/,
    type: /TABS \S+: ([^,]+),/,
    cost: /est\. cost (\$[\d,]+)/,
    start: /Est\. start ([\d-]+)/,
    owner: /Owner: ([^.]+)\./,
    scope: /Scope: (.+)$/,
  };
  return tabsNotes.match(m[key])?.[1]?.trim() ?? null;
}

function sheetHtml(o: {
  name: string;
  address: string;
  tabs: string;
  workType: string;
  projCost: string;
  start: string;
  scope: string;
  contacts: { role: string; value: string }[];
  routeIntel: string;
  bidWindow: string;
  tileUrl: string;
  maskUrl: string | null;
  acres: number;
  turf: number;
  projected: boolean;
  annualLo: number;
  annualHi: number;
  monthly: number;
  crewHours: number;
  visits: number;
  equipment: string;
  brand: string;
  today: string;
}): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box} body{width:${W}px;height:${H}px;font-family:Arial,Helvetica,sans-serif;display:flex;background:#fff;color:#17251c}
    .photo{position:relative;width:${Math.round(W * 0.46)}px;height:100%;overflow:hidden;background:#0e2a1c}
    .photo img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
    .tag{position:absolute;left:20px;bottom:20px;background:rgba(0,0,0,.7);color:#fff;font-size:20px;padding:12px 16px;border-radius:10px}
    .tag b{color:#8be29a}
    .body{flex:1;padding:48px 54px;display:flex;flex-direction:column}
    .brand{display:flex;justify-content:space-between;align-items:baseline}
    .brand .l{font-size:26px;font-weight:bold;color:#2f6f4e}
    .brand .r{font-size:16px;color:#999}
    h1{margin-top:22px;font-size:40px;line-height:1.15}
    .addr{margin-top:6px;font-size:20px;color:#555}
    .grid{margin-top:30px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
    .cell{border:1.5px solid #e2e8e4;border-radius:12px;padding:14px 16px}
    .cell .k{font-size:14px;text-transform:uppercase;letter-spacing:.5px;color:#7b8a81}
    .cell .v{margin-top:4px;font-size:24px;font-weight:bold}
    .cell .v small{font-size:15px;font-weight:normal;color:#7b8a81}
    .money{margin-top:26px;background:#0e2a1c;color:#fff;border-radius:14px;padding:22px 26px;display:flex;justify-content:space-between;align-items:center}
    .money .k{font-size:17px;color:#a8cdb6}
    .money .v{font-size:42px;font-weight:bold;color:#8be29a}
    .money .m{font-size:18px;color:#cfe8d8;text-align:right}
    .scope{margin-top:22px;font-size:16px;line-height:1.45;color:#333}
    .scope b{color:#17251c}
    .two{margin-top:20px;display:grid;grid-template-columns:1.15fr 1fr;gap:14px}
    .panelbox{border:1.5px solid #e2e8e4;border-radius:12px;padding:14px 16px}
    .panelbox .k{font-size:14px;text-transform:uppercase;letter-spacing:.5px;color:#7b8a81;margin-bottom:8px}
    .panelbox .k small{text-transform:none;letter-spacing:0}
    .panelbox .row{font-size:15.5px;line-height:1.45;color:#333;margin-top:4px}
    .fine{margin-top:auto;padding-top:16px;font-size:12.5px;color:#98a39c;line-height:1.5}
  </style></head><body>
    <div class="photo">
      <img src="${o.tileUrl}"/>
      ${o.maskUrl ? `<img src="${o.maskUrl}" style="opacity:.55"/>` : ""}
      <div class="tag">Site today · <b>detected grounds highlighted</b></div>
    </div>
    <div class="body">
      <div class="brand"><span class="l">${esc(o.brand)} · Job Intelligence</span><span class="r">${o.today} · ${esc(o.tabs)}</span></div>
      <h1>${esc(o.name)}</h1>
      <div class="addr">${esc(o.address)}</div>
      <div class="grid">
        <div class="cell"><div class="k">Project</div><div class="v">${esc(o.projCost)} <small>${esc(o.workType)}</small></div></div>
        <div class="cell"><div class="k">Est. start</div><div class="v">${esc(o.start)}</div></div>
        <div class="cell"><div class="k">Site</div><div class="v">${o.acres.toFixed(1)} ac</div></div>
        <div class="cell"><div class="k">${o.projected ? "Projected turf" : "Measured turf"}</div><div class="v">${o.turf.toLocaleString()} <small>sq ft</small></div></div>
        <div class="cell"><div class="k">Crew sizing</div><div class="v">${o.crewHours.toFixed(1)}h <small>/visit · ${o.visits} visits/yr</small></div></div>
        <div class="cell"><div class="k">Equipment</div><div class="v" style="font-size:18px">${esc(o.equipment)}</div></div>
      </div>
      <div class="money">
        <div><div class="k">Estimated maintenance contract value</div><div class="v">${usd(o.annualLo)}–${usd(o.annualHi)}<span style="font-size:20px;color:#cfe8d8">/yr</span></div></div>
        <div class="m">≈ ${usd(o.monthly)}/mo<br/>at market pricing</div>
      </div>
      <div class="scope"><b>Project scope:</b> ${esc(o.scope)}</div>
      <div class="two">
        <div class="panelbox">
          <div class="k">Decision contacts <small>(public record / self-published)</small></div>
          ${o.contacts.map((c) => `<div class="row"><b>${esc(c.role)}:</b> ${esc(c.value)}</div>`).join("")}
        </div>
        <div class="panelbox">
          <div class="k">Route intelligence &amp; bid window</div>
          <div class="row">${o.routeIntel}</div>
          <div class="row">${o.bidWindow}</div>
        </div>
      </div>
      <div class="fine">Prepared by ${esc(o.brand)} from verified project intelligence, county land records, and current
      aerial imagery. Contacts come from public filings or the organization's own published channels — no licensed databases.
      ${o.projected ? "Site is under construction — turf area is projected from parcel geometry and typical site coverage; " : ""}Maintenance value estimated at prevailing commercial rates; confirm scope on site. © ${esc(o.brand)}. Do not redistribute.</div>
    </div>
  </body></html>`;
}

function teaserTxt(o: {
  cityArea: string;
  county: string;
  workType: string;
  projCost: string;
  start: string;
  turf: number;
  annualLo: number;
  annualHi: number;
  brand: string;
}): string {
  return `SUBJECT: ${usd(o.annualHi)}/yr grounds contract coming to ${o.cityArea}

{FIRST_NAME} —

A ${o.projCost} development breaks ground around ${o.start} in the ${o.cityArea} area{DISTANCE_CLAUSE}. When it opens, somebody wins the grounds contract.

We measured the site from the air: ~${o.turf.toLocaleString()} sq ft of maintainable turf. At market rates that's ${usd(o.annualLo)}–${usd(o.annualHi)} a year — every year.

The job sheet puts everything a bidder needs on one page:

  - Exact address + aerial with the grounds highlighted
  - The owner and architect to contact (owner's mailing address included)
  - A ready-to-send intro letter and exactly when to bid
  - Crew-hour + equipment sizing for your math
  - What other measured commercial work sits within 3 miles of it

Every job is capped at 3 companies — ever — or lock it down as an exclusive. Reply "UNLOCK" and a spot is yours for {PRICE}.
First time? Reply "SAMPLE" instead and we'll send a recent sheet free, so you can judge the quality before spending a dime.

— ${o.brand}
{PHYSICAL_ADDRESS}
Reply "STOP" to never hear from us again.

[placeholders: {FIRST_NAME} {DISTANCE_CLAUSE} e.g. ", about 9 miles from your office" {PRICE} {PHYSICAL_ADDRESS}]
`;
}

async function main() {
  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company. Run db:seed.");
  const cfgRow = await getActiveConfig(co.id);
  if (!cfgRow) throw new Error("No active pricing config.");
  const cfg = toEngineConfig(cfgRow);

  const leads = await db
    .select()
    .from(schema.property)
    .where(like(schema.property.name, "%(TABS %"))
    .orderBy(desc(schema.property.created_at));

  // Route intelligence inputs: every measured+priced property with a location
  // (the buyer's real question is "does this anchor or extend a route?").
  const allProps = await db.select().from(schema.property);
  const allPrs = await db.select().from(schema.pricingResult).orderBy(desc(schema.pricingResult.created_at));
  const annualBy = new Map<string, number>();
  for (const pr of allPrs) if (!annualBy.has(pr.property_id)) annualBy.set(pr.property_id, pr.annual_price);
  const located = allProps.filter((x) => x.lat != null && x.lng != null && annualBy.has(x.id));

  await mkdir("jobsheets", { recursive: true });
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const today = new Date().toISOString().slice(0, 10);

  let n = 0;
  for (const p of leads) {
    if (n >= MAX) break;
    const parcel = p.parcel_geojson as ParcelResult | null;
    if (!parcel) {
      console.log(`  ·  no parcel   ${p.name}`);
      continue;
    }
    try {
      const tile = await fetchParcelTile(parcel, token!);
      if (!tile) {
        console.log(`  ·  no tile     ${p.name}`);
        continue;
      }
      const est = await estimateServiceableArea(parcel, token!);
      const parcelSqft = area(parcel.geometry as GeoJSON.Geometry) * M2_TO_SQFT;
      const acres = parcelSqft / 43560;
      // Raw-dirt sites can read ~0 vegetation — project from parcel geometry
      // (typical commercial sites keep ~35% of the lot as maintained grounds).
      const projected = !est || est.turf_sqft < parcelSqft * 0.08;
      const turf = Math.round(projected ? parcelSqft * 0.35 : est!.turf_sqft);

      const priced = computePricing(
        { turf_sqft: turf, bed_sqft: 0, complexity: 1.0, confidence: "Low" },
        cfg
      );
      const annualLo = roundTo(priced.annual_price * 0.8, 100);
      const annualHi = roundTo(priced.annual_price * 1.2, 100);
      const equipment =
        priced.turf_acres > 3 ? "Ride-on/zero-turn fleet + trim crew"
        : priced.turf_acres > 0.75 ? "Zero-turn + walk-behind, 2-person crew"
        : "Walk-behind + trim, small crew";

      // Live TABS lookup for the paid extras: architect/tenant + completion date.
      const tabsNum = note(p.notes, "number");
      // Buyer-facing reference: internal GK id, never the registry number — the
      // sourcing method is our trade secret (filename included: sheets get
      // emailed to buyers).
      const gkRef = `GK-${(tabsNum ?? `X${n}`).replace(/\D/g, "").slice(-5) || n}`;
      const proj = tabsNum ? await findTabsByNumber(tabsNum) : null;
      const det = proj ? await fetchTabsDetails(proj.project_id) : null;

      // Public-record / self-published contacts ONLY (licensed databases like
      // Apollo must never ship in a sold lead).
      const contacts: { role: string; value: string }[] = [];
      const owner = det?.owner ?? note(p.notes, "owner");
      if (owner) contacts.push({ role: "Owner", value: owner });
      if (parcel.owner_mailing_address) {
        contacts.push({ role: "Owner mail (county)", value: parcel.owner_mailing_address });
      }
      if (det?.tenant) contacts.push({ role: "Tenant", value: det.tenant });
      if (det?.architect) contacts.push({ role: "Architect of record", value: det.architect });
      const pub = await findContact(parcel, [p.name.replace(/ \(TABS [^)]+\)$/, ""), owner, det?.tenant]);
      if (pub?.phone) contacts.push({ role: "Published phone", value: pub.phone });
      if (pub?.email) contacts.push({ role: "Published email", value: pub.email });
      if (pub?.website) contacts.push({ role: "Website", value: pub.website });
      if (!contacts.length) contacts.push({ role: "Owner", value: "See county records" });

      // Route intelligence: measured book of business near this site.
      let routeIntel = "First measured property in this pocket — route-anchor opportunity.";
      if (p.lat != null && p.lng != null) {
        const near = located.filter(
          (x) => x.id !== p.id && haversineMiles([p.lng!, p.lat!], [x.lng!, x.lat!]) <= 3
        );
        if (near.length) {
          const total = near.reduce((s, x) => s + (annualBy.get(x.id) ?? 0), 0);
          routeIntel = `<b>${near.length}</b> other measured commercial propert${near.length === 1 ? "y" : "ies"} within 3 mi (≈ <b>${usd(total)}/yr</b> combined maintenance value) — strong route density.`;
        }
      }

      // Bid window: grounds contracts are typically awarded 1–3 months before
      // completion — tell the buyer exactly when to move.
      let bidWindow = "Completion date not yet filed — monitor and engage early.";
      if (proj?.est_end) {
        const end = new Date(proj.est_end);
        const engage = new Date(end.getTime() - 90 * 86400_000);
        bidWindow = `Est. completion <b>${end.toISOString().slice(0, 10)}</b> — grounds contracts are usually awarded 1–3 months prior. Engage the owner by <b>${engage.toISOString().slice(0, 10)}</b>.`;
      }

      const sheet = sheetHtml({
        name: p.name.replace(/ \(TABS [^)]+\)$/, ""),
        address: [p.address, p.city, p.zip].filter(Boolean).join(", "),
        tabs: gkRef,
        workType: note(p.notes, "type") ?? "New Construction",
        projCost: note(p.notes, "cost") ?? "—",
        start: note(p.notes, "start") ?? "TBD",
        scope: ((det?.scope ?? note(p.notes, "scope")) ?? "").slice(0, 220) || "—",
        contacts,
        routeIntel,
        bidWindow,
        tileUrl: `data:image/jpeg;base64,${tile.jpeg.toString("base64")}`,
        maskUrl: !projected && est ? est.mask_data_url : null,
        acres,
        turf,
        projected,
        annualLo,
        annualHi,
        monthly: priced.monthly_price,
        crewHours: priced.crew_hours_per_visit,
        visits: cfg.visits_per_year,
        equipment,
        brand: co.name,
        today,
      });
      // Engagement kit: ships WITH the purchased sheet — who to approach, how,
      // and a ready-to-send intro letter, so the buyer's path from "bought the
      // lead" to "talking to the prospect" is one paste.
      const isPublic = /\b(ISD|COUNTY|CITY OF|UNIVERSITY|STATE|DISTRICT|AUTHORITY|COLLEGE)\b/i.test(owner ?? "");
      const facility = p.name.replace(/ \(TABS [^)]+\)$/, "");
      const complete = proj?.est_end ? proj.est_end.slice(0, 10) : "completion";
      const engageBy = proj?.est_end
        ? new Date(new Date(proj.est_end).getTime() - 90 * 86400_000).toISOString().slice(0, 10)
        : "as early as possible";
      const guidance = isPublic
        ? `${owner} is a public entity: grounds work is typically bid through their purchasing department. ` +
          `Register as a vendor on their procurement site now, send the intro letter below to get on the bidder list, ` +
          `and ask the architect's office which GC holds site work.`
        : `Private owner: send the intro letter to the owner's mailing address (below) and call any published number. ` +
          `The architect of record can route you to the GC or the property manager who will hold the maintenance contract.`;
      const outreach = `ENGAGEMENT KIT — ${facility} (${gkRef})
================================================================

WHO TO APPROACH
${contacts.map((c) => `  ${c.role}: ${c.value}`).join("\n")}

HOW
  ${guidance}

WHEN
  Est. completion ${complete}. Grounds contracts are usually awarded 1-3 months
  prior — have your bid in front of the owner by ${engageBy}.

READY-TO-SEND INTRO (email or letter — replace the [brackets])
----------------------------------------------------------------
Subject: Grounds maintenance for ${facility} — local contractor

Dear ${owner ?? "Owner"},

We understand ${facility} at ${p.address ?? "the project site"} is scheduled to
complete construction around ${complete}. [YOUR COMPANY] is a licensed and
insured commercial grounds contractor serving ${p.city ?? "the area"} and the
surrounding communities, and we would welcome the opportunity to bid the
property's year-round grounds maintenance.

We are already familiar with the site — approximately ${turf.toLocaleString()} sq ft
of maintained turf — and can provide a detailed proposal, references, and a
certificate of insurance at your convenience.

Could you direct us to the right person or process for grounds vendors on this
project?

Respectfully,
[NAME]
[YOUR COMPANY] · [PHONE] · [EMAIL]
----------------------------------------------------------------
Prepared by ${co.name}. Do not redistribute.
`;

      const safe = gkRef.toLowerCase();
      await page.setContent(sheet, { waitUntil: "load" });
      await page.screenshot({ path: `jobsheets/${safe}-sheet.png` });
      await writeFile(
        `jobsheets/${safe}-teaser.txt`,
        teaserTxt({
          cityArea: p.city ?? parcel.county,
          county: parcel.county,
          workType: note(p.notes, "type") ?? "construction",
          projCost: note(p.notes, "cost") ?? "large",
          start: note(p.notes, "start") ?? "soon",
          turf,
          annualLo,
          annualHi,
          brand: co.name,
        })
      );
      await writeFile(`jobsheets/${safe}-outreach.txt`, outreach);
      n++;
      console.log(`  ✓  ${p.name} — turf ${turf.toLocaleString()} sf${projected ? " (projected)" : ""}, ${usd(annualLo)}–${usd(annualHi)}/yr`);
    } catch (e) {
      console.log(`  !  ${p.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  await browser.close();
  console.log(`\nDone. ${n} job sheet(s) + teaser(s) -> jobsheets/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
