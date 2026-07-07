import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { mkdir, writeFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { desc, inArray, isNotNull } from "drizzle-orm";
import QRCode from "qrcode";
import { chromium } from "playwright";
import * as schema from "../lib/db/schema";
import { fetchParcelTile } from "../lib/integrations/imagery";
import type { ParcelResult, ServiceAreaCollection } from "../lib/geo/types";

// Aerial-quote postcards: for every send-ready property that has a county
// owner MAILING address (the no-email segment), render a print-ready 6x9"
// postcard — front: their property from above with the measured turf overlay,
// the estimate range, and a QR to their hosted proposal; back: message +
// address block. 300 DPI with bleed (Lob-compatible), so a print-mail API is a
// drop-in later. Attribution is free: these properties have no email, so any
// proposal view on their slug is a postcard scan.
//
// Run:  npm run postcards            (all mailable, max 40)
//       npm run postcards -- 10      (first 10)
// Out:  postcards/<slug>-front.png / -back.png + manifest.csv

const MAX = Number(process.argv[2]) || 40;
// 6.25" x 9.25" at 300 DPI (6x9 + 1/8" bleed all around).
const W = 2775;
const H = 1875;

const url = process.env.DATABASE_URL;
const token = process.env.MAPBOX_API ?? null;
if (!url) throw new Error("DATABASE_URL is not set.");
if (!token) throw new Error("MAPBOX_API is not set.");
const db = drizzle(neon(url), { schema });

const roundTo = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Bbox = { minLng: number; minLat: number; maxLng: number; maxLat: number };

/** lng/lat ring -> SVG points string in tile pixel space. */
function ringToPoints(ring: number[][], b: Bbox, w: number, h: number): string {
  return ring
    .map(([lng, lat]) => {
      const x = ((lng - b.minLng) / (b.maxLng - b.minLng)) * w;
      const y = ((b.maxLat - lat) / (b.maxLat - b.minLat)) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function overlaySvg(
  parcel: ParcelResult,
  areas: ServiceAreaCollection | null,
  b: Bbox,
  w: number,
  h: number,
  accent: string
): string {
  const polys: string[] = [];
  // Measured turf (turf + sports_turf) — the money shot.
  for (const f of areas?.features ?? []) {
    const kind = f.properties.kind;
    if (kind !== "turf" && kind !== "sports_turf") continue;
    for (const ring of [f.geometry.coordinates[0]]) {
      polys.push(
        `<polygon points="${ringToPoints(ring as number[][], b, w, h)}" fill="${accent}" fill-opacity="0.4" stroke="#ffffff" stroke-width="${w / 700}"/>`
      );
    }
  }
  // Parcel boundary (always).
  const rings =
    parcel.geometry.type === "Polygon"
      ? [parcel.geometry.coordinates[0] as number[][]]
      : (parcel.geometry.coordinates as number[][][][]).map((p) => p[0]);
  for (const ring of rings) {
    polys.push(
      `<polygon points="${ringToPoints(ring, b, w, h)}" fill="none" stroke="#ffe14d" stroke-width="${w / 350}" stroke-dasharray="${w / 90} ${w / 140}"/>`
    );
  }
  // "slice" is SVG's object-fit:cover — must match the <img> so the measured
  // polygons stay registered on the imagery at any tile aspect.
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" style="position:absolute;inset:0;width:100%;height:100%">${polys.join("")}</svg>`;
}

function frontHtml(opts: {
  name: string;
  tileDataUrl: string;
  tileW: number;
  tileH: number;
  overlay: string;
  turfSqft: number;
  low: number;
  high: number;
  qrDataUrl: string;
  brand: string;
  accent: string;
}): string {
  const { name, tileDataUrl, tileW, tileH, overlay, turfSqft, low, high, qrDataUrl, brand, accent } = opts;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { width:${W}px; height:${H}px; font-family: Arial, Helvetica, sans-serif; display:flex; background:#0e2a1c; }
    .photo { position:relative; width:${Math.round(W * 0.58)}px; height:100%; overflow:hidden; background:#0e2a1c; display:flex; align-items:center; justify-content:center; }
    .photo .frame { position:relative; width:100%; height:100%; }
    .photo img.tile { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
    .badge { position:absolute; left:40px; bottom:40px; background:rgba(0,0,0,.72); color:#fff; padding:28px 36px; border-radius:20px; font-size:44px; }
    .badge b { color:#8be29a; }
    .panel { flex:1; background:#0e2a1c; color:#fff; padding:110px 90px 90px; display:flex; flex-direction:column; }
    .brand { font-size:54px; font-weight:bold; letter-spacing:.5px; color:#8be29a; }
    h1 { margin-top:70px; font-size:96px; line-height:1.08; }
    .sqft { margin-top:60px; font-size:52px; color:#cfe8d8; }
    .sqft b { color:#fff; font-size:64px; }
    .price { margin-top:26px; font-size:110px; font-weight:bold; color:#8be29a; }
    .per { font-size:48px; color:#cfe8d8; font-weight:normal; }
    .cta { margin-top:auto; display:flex; align-items:center; gap:44px; }
    .cta img { width:330px; height:330px; background:#fff; padding:18px; border-radius:24px; }
    .cta .t { font-size:46px; line-height:1.35; color:#e8f5ec; }
  </style></head><body>
    <div class="photo"><div class="frame">
      <img class="tile" src="${tileDataUrl}" style="aspect-ratio:${tileW}/${tileH}"/>
      ${overlay}
      <div class="badge">Your property · <b>measured from above</b></div>
    </div></div>
    <div class="panel">
      <div class="brand">${esc(brand)}</div>
      <h1>We already measured your grounds.</h1>
      <div class="sqft"><b>${turfSqft.toLocaleString()} sq ft</b> of maintained turf at<br/>${esc(name)}</div>
      <div class="price">${money(low)}–${money(high)}<span class="per">/mo</span></div>
      <div class="cta">
        <img src="${qrDataUrl}"/>
        <div class="t"><b>Scan to see your full proposal</b> — satellite measurement, scope &amp; pricing. Exact price confirmed with a free walkthrough.</div>
      </div>
    </div>
  </body></html>`;
}

function backHtml(opts: {
  owner: string | null;
  mail: string;
  propertyName: string;
  qrDataUrl: string;
  proposalUrl: string;
  brand: string;
  brandAddress: string | null;
}): string {
  const { owner, mail, propertyName, qrDataUrl, proposalUrl, brand, brandAddress } = opts;
  const mailLines = mail.split(/,\s*/).map(esc).join("<br/>");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { width:${W}px; height:${H}px; font-family: Arial, Helvetica, sans-serif; background:#ffffff; color:#1a1a1a; display:flex; }
    .msg { width:${Math.round(W * 0.55)}px; padding:130px 100px; border-right:3px solid #e5e5e5; }
    .brand { font-size:46px; font-weight:bold; color:#2f6f4e; }
    h2 { margin-top:60px; font-size:64px; line-height:1.2; }
    p { margin-top:40px; font-size:40px; line-height:1.5; color:#333; }
    .fine { margin-top:auto; padding-top:50px; font-size:28px; color:#888; }
    .qr { margin-top:56px; display:flex; align-items:center; gap:36px; }
    .qr img { width:300px; height:300px; }
    .qr span { font-size:34px; color:#555; word-break:break-all; }
    .addr { flex:1; display:flex; flex-direction:column; justify-content:center; padding:100px; }
    .addr .to { font-size:34px; color:#888; margin-bottom:24px; }
    .addr .block { font-size:48px; line-height:1.5; }
    .footer { position:absolute; bottom:60px; left:100px; font-size:28px; color:#999; }
  </style></head><body>
    <div class="msg">
      <div class="brand">${esc(brand)}</div>
      <h2>No sales visit needed — the measuring is already done.</h2>
      <p>We measured the grounds at <b>${esc(propertyName)}</b> from current aerial imagery and prepared a complete maintenance proposal. Scan the code to review it, then book a free walkthrough to lock the exact price.</p>
      <div class="qr"><img src="${qrDataUrl}"/><span>${esc(proposalUrl)}</span></div>
      <div class="fine">Estimate from aerial measurement; final price confirmed on site. ${brandAddress ? esc(`${brand} · ${brandAddress}`) : esc(brand)}</div>
    </div>
    <div class="addr">
      <div class="to">TO:</div>
      <div class="block">${owner ? `<b>${esc(owner)}</b><br/>` : ""}${mailLines}</div>
    </div>
  </body></html>`;
}

async function main() {
  // Cards are physical — a dev URL would print a dead QR code. Prefer the env
  // base, but never localhost.
  let base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (!base || /localhost|127\.0\.0\.1/.test(base)) {
    base = "https://greenkeep.us";
    console.log(`  (NEXT_PUBLIC_APP_URL is unset/localhost — QR links use ${base})\n`);
  }
  const [co] = await db.select().from(schema.company).limit(1);
  const brand = co?.name ?? "Greenkeep";
  const accent = co?.brand_color || "#2f7d4f";

  // Send-ready properties (proposal exists) — the postcard segment is the ones
  // with a county mailing address; no-email ones are the priority audience.
  const props = await db
    .select()
    .from(schema.property)
    .where(inArray(schema.property.status, ["proposal_ready", "outreach_drafted", "sent"]))
    .orderBy(desc(schema.property.updated_at));
  const ids = props.map((p) => p.id);
  const [proposals, prs, meas] = await Promise.all([
    db.select().from(schema.proposal).where(inArray(schema.proposal.property_id, ids)).orderBy(desc(schema.proposal.created_at)),
    db.select().from(schema.pricingResult).where(inArray(schema.pricingResult.property_id, ids)).orderBy(desc(schema.pricingResult.created_at)),
    db
      .select()
      .from(schema.measurement)
      .where(inArray(schema.measurement.property_id, ids))
      .orderBy(desc(schema.measurement.created_at)),
  ]);
  const first = <T extends { property_id: string }>(rows: T[]) => {
    const m = new Map<string, T>();
    for (const r of rows) if (!m.has(r.property_id)) m.set(r.property_id, r);
    return m;
  };
  const propBy = first(proposals);
  const prBy = first(prs);
  const measBy = first(meas);

  await mkdir("postcards", { recursive: true });
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage({ viewport: { width: W, height: H } });

  const manifest: string[] = ["slug,property,owner,mailing_address,front,back,proposal_url"];
  let n = 0;
  for (const p of props) {
    if (n >= MAX) break;
    const parcel = p.parcel_geojson as ParcelResult | null;
    const mail = parcel?.owner_mailing_address ?? null;
    const slugRow = propBy.get(p.id);
    const pr = prBy.get(p.id);
    const m = measBy.get(p.id);
    if (!parcel || !mail || !slugRow || !pr || !m) continue;

    try {
      const tile = await fetchParcelTile(parcel, token!);
      if (!tile) {
        console.log(`  ·  no tile     ${p.name}`);
        continue;
      }
      const proposalUrl = `${base}/proposals/${slugRow.slug}`;
      const qr = await QRCode.toDataURL(proposalUrl, { width: 660, margin: 1 });
      const low = roundTo(pr.monthly_price * 0.85, 5);
      const high = roundTo(pr.monthly_price * 1.25, 5);
      const b = { minLng: tile.minLng, minLat: tile.minLat, maxLng: tile.maxLng, maxLat: tile.maxLat };
      const overlay = overlaySvg(
        parcel,
        (m.service_areas as ServiceAreaCollection | null) ?? null,
        b,
        tile.width,
        tile.height,
        accent
      );
      const tileDataUrl = `data:image/jpeg;base64,${tile.jpeg.toString("base64")}`;

      const safe = slugRow.slug.replace(/[^a-z0-9-]/gi, "_");
      await page.setContent(
        frontHtml({
          name: p.name,
          tileDataUrl,
          tileW: tile.width,
          tileH: tile.height,
          overlay,
          turfSqft: m.turf_sqft,
          low,
          high,
          qrDataUrl: qr,
          brand,
          accent,
        }),
        { waitUntil: "load" }
      );
      await page.screenshot({ path: `postcards/${safe}-front.png` });
      await page.setContent(
        backHtml({
          owner: parcel.owner,
          mail,
          propertyName: p.name,
          qrDataUrl: qr,
          proposalUrl,
          brand,
          brandAddress: co?.physical_mailing_address ?? null,
        }),
        { waitUntil: "load" }
      );
      await page.screenshot({ path: `postcards/${safe}-back.png` });

      manifest.push(
        [slugRow.slug, p.name, parcel.owner ?? "", mail, `${safe}-front.png`, `${safe}-back.png`, proposalUrl]
          .map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v))
          .join(",")
      );
      n++;
      console.log(`  ✓  ${p.name}`);
    } catch (e) {
      console.log(`  !  ${p.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  await browser.close();
  await writeFile("postcards/manifest.csv", manifest.join("\n") + "\n");
  console.log(`\nDone. ${n} postcard(s) -> postcards/ (+ manifest.csv). 6.25x9.25in @300dpi (6x9 + bleed).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
