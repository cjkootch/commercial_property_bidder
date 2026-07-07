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
  owner: string;
  scope: string;
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
    .scope{margin-top:24px;font-size:17px;line-height:1.5;color:#333}
    .scope b{color:#17251c}
    .fine{margin-top:auto;font-size:13px;color:#98a39c;line-height:1.5}
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
      <div class="scope"><b>Owner:</b> ${esc(o.owner)} &nbsp;·&nbsp; <b>Registered scope:</b> ${esc(o.scope)}</div>
      <div class="fine">Prepared from public records (TDLR TABS, county parcel/appraisal) and current aerial imagery.
      ${o.projected ? "Site is under construction — turf area is projected from parcel geometry and typical site coverage; " : ""}Maintenance value estimated at prevailing commercial rates; confirm scope on site. © ${esc(o.brand)}.</div>
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
  return `SUBJECT: New ${o.county} County grounds contract coming — est. ${usd(o.annualLo)}–${usd(o.annualHi)}/yr

Hi {FIRST_NAME},

A ${o.projCost} commercial ${o.workType.toLowerCase()} project has been registered in the ${o.cityArea} area{DISTANCE_CLAUSE}, with construction starting around ${o.start}.

When it opens, it will need year-round grounds maintenance:

  - ~${o.turf.toLocaleString()} sq ft of maintainable turf (measured from aerial imagery)
  - Estimated contract value: ${usd(o.annualLo)}–${usd(o.annualHi)}/yr
  - Registered scope includes landscaping/site work

We prepared the full job sheet: exact address, owner/decision-maker, site measurement with aerial, crew-hour sizing, and the registered scope of work.

Reply "UNLOCK" and it's yours for {PRICE} — sold to one company only, first come.
(Your first sheet is free — reply "SAMPLE" and we'll send one from a recent project so you can judge the quality.)

— ${o.brand}
{PHYSICAL_ADDRESS}
Reply "STOP" to never hear from us again.

[placeholders: {FIRST_NAME} {DISTANCE_CLAUSE} e.g. ", about 9 miles from your office" (haversine vs buyer office) {PRICE} {PHYSICAL_ADDRESS}]
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

      const sheet = sheetHtml({
        name: p.name.replace(/ \(TABS [^)]+\)$/, ""),
        address: [p.address, p.city, p.zip].filter(Boolean).join(", "),
        tabs: note(p.notes, "number") ?? "TABS",
        workType: note(p.notes, "type") ?? "New Construction",
        projCost: note(p.notes, "cost") ?? "—",
        start: note(p.notes, "start") ?? "TBD",
        owner: note(p.notes, "owner") ?? "See records",
        scope: (note(p.notes, "scope") ?? "").slice(0, 260) || "—",
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
      const safe = (note(p.notes, "number") ?? `lead-${n}`).toLowerCase();
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
