// Orlando (Orange County, FL) distress lead sourcing — tax-deed auctions
// (orange.realtaxdeed.com) + mortgage foreclosures (orange.realforeclose.com),
// both on the Grant Street Group / RealAuction ColdFusion platform. A property
// heading to a forced sale is a distress signal: the owner (or the next owner)
// needs grounds/service work. Sold as a `(TAX <case#>)` DISTRESS lead — the
// same marker the Texas LGBS tax-sale feed uses.
//
// The site is a stateful ColdFusion AJAX app (OpenClaw round 10 characterized
// the handshake — docs/market-research/orange-realauction-handshake-2026-07-12.md):
//   1. GET …zaction=USER&zmethod=CALENDAR       → upcoming sale days (dayid=…)
//   2. GET …Zmethod=PREVIEW&AUCTIONDATE=MM/DD/YYYY  → seeds cfid/cftoken + binds
//      the date to the CF session (MANDATORY — a cold LOAD returns 0 rows)
//   3. GET …Zmethod=UPDATE&FNC=LOAD&AREA=W          → JSON {retHTML}, a
//      token-compressed HTML fragment of the upcoming parcel roster
// A plain cookie-jar fetch reproduces it — no headless browser. Send a real
// User-Agent (empty-UA 403s); pace politely; stop on 401/403/429.

import { db } from "../db";
import * as schema from "../db/schema";
import { geocodeAddress } from "../integrations/geocoding";
import { fetchParcelAtPoint } from "../integrations/parcel";
import { sizeLead } from "../leads/sizing";
import { getActiveConfig, toEngineConfig } from "../db/queries";
import { icpGuess } from "./permits";
import type { ParcelResult } from "../geo/types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const SITES = {
  taxdeed: { host: "https://orange.realtaxdeed.com", label: "tax-deed" },
  foreclosure: { host: "https://orange.realforeclose.com", label: "foreclosure" },
} as const;
type SiteKey = keyof typeof SITES;

// retHTML token-substitution table (from auction.js LoadNewArea).
const TOKENS: [string, string][] = [
  ["@A", '<div class="'],
  ["@B", "</div>"],
  ["@C", 'class="'],
  ["@D", "<div>"],
  ["@E", "AUCTION"],
  ["@F", "</td><td"],
  ["@G", "</td></tr>"],
  ["@H", "<tr><td"],
  ["@I", "table"],
  ["@J", 'p_back="NextCheck='],
  ["@K", 'style="Display:none"'],
  ["@L", "/index.cfm?zaction=auction&zmethod=details&AID="],
];
function expandTokens(s: string): string {
  for (const [t, v] of TOKENS) s = s.split(t).join(v);
  return s;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const stripTags = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export type DistressSummary = {
  scanned: number;
  candidates: number;
  added: number;
  log: string[];
};

/** Enumerate upcoming sale dates (MM/DD/YYYY) from a site's calendar, this
 *  month + the next, filtered to today-or-later. */
async function upcomingSaleDates(host: string): Promise<string[]> {
  const dates = new Set<string>();
  const now = new Date();
  for (let mo = 0; mo < 2; mo++) {
    const d = new Date(now.getFullYear(), now.getMonth() + mo, 1);
    const sel = `{ts '${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01 00:00:00'}`;
    const url = `${host}/index.cfm?zaction=user&zmethod=calendar&selCalDate=${encodeURIComponent(sel)}`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) continue;
    const html = await res.text();
    // Sale days are CALSELT cells carrying a dayid="MM/DD/YYYY".
    for (const m of html.matchAll(/CALSELT[\s\S]{0,400}?dayid=['"](\d{2}\/\d{2}\/\d{4})['"]/g)) {
      const [mm, dd, yyyy] = m[1].split("/").map(Number);
      if (new Date(yyyy, mm - 1, dd) >= new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
        dates.add(m[1]);
      }
    }
    await sleep(1500);
  }
  return [...dates].sort();
}

/** Seed the CF session with a date, then LOAD the upcoming (AREA=W) roster. */
async function loadRoster(host: string, date: string): Promise<string | null> {
  const seed = await fetch(
    `${host}/index.cfm?zaction=AUCTION&Zmethod=PREVIEW&AUCTIONDATE=${encodeURIComponent(date)}`,
    { headers: { "User-Agent": UA } }
  );
  if (!seed.ok) return null;
  const jar = (seed.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  await sleep(1500);
  const load = await fetch(
    `${host}/index.cfm?zaction=AUCTION&Zmethod=UPDATE&FNC=LOAD&AREA=W&PageDir=0&doR=0&tx=${Date.now()}&bypassPage=0&test=1`,
    { headers: { "User-Agent": UA, Cookie: jar } }
  );
  if (!load.ok) return null;
  const data = (await load.json().catch(() => null)) as { retHTML?: string } | null;
  return data?.retHTML ? expandTokens(data.retHTML) : "";
}

type Row = { caseNo: string; bid: string; parcelId: string; addr: string; assessed: string };

/** Parse the expanded retHTML into parcel rows. Both sites label their cells
 *  AD_LBL / AD_DTA (tax-deed = table cells, foreclosure = float divs); parse by
 *  the label string, not column order. */
function parseRoster(html: string): Row[] {
  const rows: Row[] = [];
  const items = html.split(/id="AITEM_/).slice(1); // one chunk per parcel item
  for (const chunk of items) {
    const pairs: { label: string; value: string }[] = [];
    const re =
      /class="AD_LBL"[^>]*>([\s\S]*?)<\/(?:td|div)>\s*<(?:td|div)[^>]*class="AD_DTA"[^>]*>([\s\S]*?)<\/(?:td|div)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(chunk))) pairs.push({ label: stripTags(m[1]), value: stripTags(m[2]) });
    if (!pairs.length) continue;
    const find = (rx: RegExp) => pairs.find((p) => rx.test(p.label))?.value ?? "";
    // Property address is two rows: "Property Address" line + an empty-label
    // city/state line right after it.
    const addrIdx = pairs.findIndex((p) => /property address/i.test(p.label));
    const line1 = addrIdx >= 0 ? pairs[addrIdx].value : "";
    const line2 = addrIdx >= 0 && !pairs[addrIdx + 1]?.label ? pairs[addrIdx + 1]?.value ?? "" : "";
    rows.push({
      caseNo: find(/case/i),
      bid: find(/opening bid|final judgment/i),
      parcelId: find(/parcel/i),
      addr: [line1, line2].filter(Boolean).join(", ").replace(/FL-\s*/i, "FL "),
      assessed: find(/assessed value/i),
    });
  }
  return rows;
}

export async function runOrlandoDistressSourcing(opts?: {
  want?: number;
  maxDates?: number;
  sites?: SiteKey[];
  apply?: boolean;
}): Promise<DistressSummary> {
  const want = opts?.want ?? 8;
  const maxDates = opts?.maxDates ?? 3;
  const sites = opts?.sites ?? (["taxdeed", "foreclosure"] as SiteKey[]);
  const apply = opts?.apply ?? true;
  const log: string[] = [];

  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company found. Run `npm run db:seed` first.");
  const existing = await db.select({ name: schema.property.name }).from(schema.property);
  const have = new Set(existing.map((r) => r.name.trim().toLowerCase()));
  const cfgRow = await getActiveConfig(co.id);

  let scanned = 0;
  let added = 0;
  const seenCase = new Set<string>();
  for (const key of sites) {
    if (added >= want) break;
    const site = SITES[key];
    const dates = (await upcomingSaleDates(site.host)).slice(0, maxDates);
    log.push(`${site.label}: ${dates.length} upcoming sale date(s): ${dates.join(", ") || "none"}`);
    for (const date of dates) {
      if (added >= want) break;
      const html = await loadRoster(site.host, date);
      await sleep(1500);
      if (!html) {
        log.push(`  ${date}: no roster`);
        continue;
      }
      const rows = parseRoster(html);
      scanned += rows.length;
      const saleIso = (() => {
        const [mm, dd, yyyy] = date.split("/");
        return `${yyyy}-${mm}-${dd}`;
      })();
      for (const r of rows) {
        if (added >= want) break;
        if (!r.caseNo || seenCase.has(r.caseNo)) continue;
        seenCase.add(r.caseNo);
        const label = (r.addr.split(",")[0] || `${site.label} lot`).trim();
        const name = `${label} (TAX ${r.caseNo})`;
        if (have.has(name.trim().toLowerCase())) continue;
        if (!r.addr || !/\d/.test(r.addr)) {
          log.push(`  ${date} ${r.caseNo}: no usable address`);
          continue;
        }

        const coords = await geocodeAddress(r.addr.includes("FL") ? r.addr : `${r.addr}, FL`);
        const parcel = coords ? await fetchParcelAtPoint(coords[0], coords[1]) : null;

        const notes =
          `Orange County ${site.label} auction ${r.caseNo}. ` +
          `Tax sale scheduled ${saleIso}.` +
          (r.bid ? ` ${key === "foreclosure" ? "Judgment" : "Opening bid"} ${r.bid}.` : "") +
          (r.assessed ? ` Assessed ${r.assessed}.` : "") +
          (parcel?.owner ? ` Owner: ${parcel.owner}.` : "");

        let teaser: Record<string, unknown> | null = null;
        if (parcel && cfgRow && process.env.MAPBOX_API) {
          try {
            const sz = await sizeLead(parcel as ParcelResult, process.env.MAPBOX_API, toEngineConfig(cfgRow));
            teaser = {
              annual_lo: sz.annual_lo,
              annual_hi: sz.annual_hi,
              turf_sqft: sz.turf_sqft,
              projected: sz.projected,
              computed_at: new Date().toISOString().slice(0, 10),
            };
          } catch {
            /* teaser optional */
          }
        }

        if (apply) {
          await db.insert(schema.property).values({
            company_id: co.id,
            name,
            address: label,
            city: r.addr.split(",")[1]?.trim() || "Orlando",
            zip: null,
            lat: coords?.[1] ?? null,
            lng: coords?.[0] ?? null,
            icp_type: icpGuess(`${parcel?.owner ?? ""} ${label}`),
            owner_org: null, // suggestion only — operator confirms (spec §9)
            source: "places",
            status: "sourced",
            parcel_geojson: parcel,
            lead_teaser: teaser,
            notes,
          });
        }
        have.add(name.trim().toLowerCase());
        added++;
        log.push(
          `  ${apply ? "added" : "would add"} ${site.label} ${label} (${r.caseNo})` +
            `${coords ? "" : " (no geocode)"}${parcel ? "" : " (no parcel)"}`
        );
      }
    }
  }

  return { scanned, candidates: scanned, added, log };
}
