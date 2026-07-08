import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { desc, like } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { getActiveConfig, toEngineConfig } from "../lib/db/queries";
import { searchLandscapers, type BuyerCandidate } from "../lib/integrations/apollo";
import { scrapeBusinessContact } from "../lib/integrations/contact";
import { geocodeAddress } from "../lib/integrations/geocoding";
import { sizeLead } from "../lib/leads/sizing";
import { leadMaxBuyers } from "../lib/leads/availability";
import { signBuyerClaim } from "../lib/buyer-auth";
import { haversineMiles } from "../lib/sourcing/criteria";
import type { ParcelResult } from "../lib/geo/types";

// Buyer campaign kit: HONEST, ready-to-paste outreach for prospective lead
// buyers (landscaping companies), each personalized with the nearest TABS lead
// and the distance from THEIR office. The message never impersonates a
// customer — it says exactly what we are and offers the first job sheet free.
//
// NOTHING IS SENT. Output is a paste kit: per-company message .txt files (with
// their contact-form URL + published email) and a tracking CSV. A human pastes
// and replies land in your inbox — which is how the buyer list builds itself.
//
// Buyer sources (Apollo is for OUR targeting only; it never ships in a sold lead):
//   campaign/buyers.csv (name,website,address) if present — else Apollo search.
//
// Run:  npm run campaign               (up to 20 buyers, $79 price)
//       npm run campaign -- 10 99

const MAX_BUYERS = Number(process.argv[2]) || 20;
const PRICE = Number(process.argv[3]) || 79;

const url = process.env.DATABASE_URL;
const token = process.env.MAPBOX_API ?? null;
if (!url) throw new Error("DATABASE_URL is not set.");
if (!token) throw new Error("MAPBOX_API is not set.");
const db = drizzle(neon(url), { schema });

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

function note(notes: string | null, re: RegExp): string | null {
  return notes?.match(re)?.[1]?.trim() ?? null;
}

type SizedLead = {
  id: string;
  tabs: string;
  city: string | null;
  cost: string;
  workType: string;
  start: string;
  turf: number;
  annualLo: number;
  annualHi: number;
  lat: number;
  lng: number;
};

function message(o: {
  company: string;
  distClause: string;
  distShort: string;
  lead: SizedLead;
  brand: string;
  replyEmail: string;
  price: number;
  cap: number;
  claimUrl: string;
}): string {
  const { lead } = o;
  return `SUBJECT: ${usd(lead.annualHi)}/yr grounds contract coming${o.distShort}

${o.company} team —

A ${lead.cost} development breaks ground around ${lead.start},${o.distClause}${lead.city ? ` (${lead.city} area)` : ""}. When it opens, somebody wins the grounds contract.

We measured the site from the air: ~${lead.turf.toLocaleString()} sq ft of maintainable turf. At market rates that's ${usd(lead.annualLo)}–${usd(lead.annualHi)} a year — every year.

Everything a bidder needs is on one page: exact location, the owner and architect to contact, our measurement, crew sizing, and the window to bid. Every job is capped at ${o.cap} companies — ever — and you can lock one down as an exclusive so nobody else gets it.

Your first sheet is FREE — claim it here (takes 30 seconds, no card):
${o.claimUrl}

The full sheet unlocks the moment you create your profile. After that, sheets run $39-$129 depending on contract size. Or just reply "SEND IT" and we'll set it up for you.

— ${o.brand}
${o.replyEmail}

P.S. If this one's too far or the wrong size, reply with your service area and we'll send the next match instead.
`;
}

/** Public site base for claim links — never leak a localhost dev URL. */
function siteBase(): string {
  const envBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (envBase && !/localhost|127\.0\.0\.1/.test(envBase)) return envBase;
  console.log("  (!) NEXT_PUBLIC_APP_URL unset or localhost — claim links use https://greenkeep.us");
  return "https://greenkeep.us";
}

function parseBuyersCsv(path: string): BuyerCandidate[] {
  const rows = readFileSync(path, "utf8").trim().split("\n");
  const out: BuyerCandidate[] = [];
  for (const row of rows.slice(1)) {
    const [name, website, address] = row.split(",").map((s) => s?.trim());
    if (!name) continue;
    out.push({ name, website: website || null, city: address || null, state: null });
  }
  return out;
}

const csvEsc = (v: string | number | null) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  const [co] = await db.select().from(schema.company).limit(1);
  if (!co) throw new Error("No company. Run db:seed.");
  const cfgRow = await getActiveConfig(co.id);
  if (!cfgRow) throw new Error("No active pricing config.");
  const cfg = toEngineConfig(cfgRow);
  const replyEmail = co.email?.trim() || "{YOUR_REPLY_EMAIL}";
  if (replyEmail.startsWith("{")) {
    console.log("  (!) company.email is empty — messages carry a {YOUR_REPLY_EMAIL} placeholder.\n");
  }

  // --- Size the TABS leads (in-memory; identical math to the job sheets) ----
  // Only leads that can still be sold: not exported/closed, not exclusive, and
  // shared spots left under the cap.
  const cap = leadMaxBuyers();
  const unlockRows = await db.select().from(schema.leadUnlock);
  const unlockCount = new Map<string, number>();
  const exclusiveProps = new Set<string>();
  for (const u of unlockRows) {
    unlockCount.set(u.property_id, (unlockCount.get(u.property_id) ?? 0) + 1);
    if (u.kind === "exclusive") exclusiveProps.add(u.property_id);
  }
  const leadRows = await db
    .select()
    .from(schema.property)
    .where(like(schema.property.name, "%(TABS %"))
    .orderBy(desc(schema.property.created_at));
  const leads: SizedLead[] = [];
  for (const p of leadRows) {
    if (p.lead_exported_at != null || exclusiveProps.has(p.id) || (unlockCount.get(p.id) ?? 0) >= cap) continue;
    const parcel = p.parcel_geojson as ParcelResult | null;
    if (!parcel || p.lat == null || p.lng == null) continue;
    try {
      const s = await sizeLead(parcel, token!, cfg);
      leads.push({
        id: p.id,
        tabs: note(p.notes, /TABS (\S+):/) ?? "TABS",
        city: p.city,
        cost: note(p.notes, /est\. cost (\$[\d,]+)/) ?? "large",
        workType: note(p.notes, /TABS \S+: ([^,]+),/) ?? "construction",
        start: note(p.notes, /Est\. start ([\d-]+)/) ?? "soon",
        turf: s.turf_sqft,
        annualLo: s.annual_lo,
        annualHi: s.annual_hi,
        lat: p.lat,
        lng: p.lng,
      });
      console.log(`  lead ${leads[leads.length - 1].tabs} — ${s.turf_sqft.toLocaleString()} sf, ${usd(s.annual_lo)}–${usd(s.annual_hi)}/yr`);
    } catch {
      /* skip unsizable lead */
    }
  }
  if (!leads.length) throw new Error("No sizable TABS leads. Run `npm run source:permits` first.");

  // --- Buyers -----------------------------------------------------------------
  let buyers: BuyerCandidate[];
  if (existsSync("campaign/buyers.csv")) {
    buyers = parseBuyersCsv("campaign/buyers.csv");
    console.log(`\n  ${buyers.length} buyer(s) from campaign/buyers.csv`);
  } else {
    buyers = await searchLandscapers("Houston, Texas", MAX_BUYERS);
    console.log(`\n  ${buyers.length} buyer(s) from Apollo search (own-outreach targeting only)`);
  }
  // "First sheet free" is once per company — don't tease companies that
  // already have a profile (they'd just hit the once-per-buyer guard anyway).
  const existingBuyers = await db.select().from(schema.buyer);
  const knownNames = new Set(existingBuyers.map((b) => b.company_name.trim().toLowerCase()));
  const before = buyers.length;
  buyers = buyers.filter((b) => !knownNames.has(b.name.trim().toLowerCase()));
  if (before !== buyers.length) console.log(`  (${before - buyers.length} skipped — already have buyer profiles)`);

  buyers = buyers.slice(0, MAX_BUYERS);
  if (!buyers.length) throw new Error("No buyers (set APOLLO_API_KEY or provide campaign/buyers.csv).");

  const stamp = new Date().toISOString().slice(0, 10);
  const dir = `campaign/${stamp}`;
  await mkdir(`${dir}/messages`, { recursive: true });
  const base = siteBase();
  if (!process.env.BUYER_AUTH_SECRET) {
    console.log(
      "  (!) BUYER_AUTH_SECRET is not set locally — claim links are signed with a fallback secret.\n" +
        "      They will show as EXPIRED in production unless the same secret chain is set in Vercel."
    );
  }

  const csv: string[] = [
    "company,website,contact_form_url,published_email,published_phone,office_area,distance_mi,lead_tabs,lead_value_yr,message_file,status",
  ];
  let n = 0;
  for (const b of buyers) {
    const officeArea = b.city ? `${b.city}${b.state ? `, ${b.state}` : ""}` : null;
    // Office areas are often just a city name — allow place-type matches.
    const coords = officeArea
      ? await geocodeAddress(`${officeArea}${b.state ? "" : ", TX"}`, "place,address,poi")
      : null;

    // Nearest lead (fall back to highest value when the office can't be placed).
    let lead = leads[0];
    let dist: number | null = null;
    if (coords) {
      for (const l of leads) {
        const d = haversineMiles([coords[0], coords[1]], [l.lng, l.lat]);
        if (dist === null || d < dist) {
          dist = d;
          lead = l;
        }
      }
    } else {
      lead = [...leads].sort((a, b2) => b2.annualHi - a.annualHi)[0];
    }
    const mi = dist != null ? Math.max(1, Math.round(dist)) : null;
    const distClause = mi != null ? ` about ${mi} ${mi === 1 ? "mile" : "miles"} from your office` : " in your service area";
    const distShort = mi != null ? `, ${mi} mi from your office` : " near you";

    const contact = b.website ? await scrapeBusinessContact(b.website) : { email: null, phone: null, contact_form_url: null };

    // Per-buyer claim link: 30-day token carrying the lead + suggested company
    // name. Opening it lands on /buyers/claim/<token> — profile creation IS the
    // free unlock (takes one of the lead's capped shared spots).
    const claimUrl = `${base}/buyers/claim/${signBuyerClaim(lead.id, b.name)}`;

    const msg = message({ company: b.name, distClause, distShort, lead, brand: co.name, replyEmail, price: PRICE, cap, claimUrl });
    const safe = b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
    await writeFile(`${dir}/messages/${safe}.txt`, msg);

    csv.push(
      [
        b.name, b.website ?? "", contact.contact_form_url ?? "", contact.email ?? "", contact.phone ?? "",
        officeArea ?? "", dist != null ? dist.toFixed(1) : "", lead.tabs, `${usd(lead.annualLo)}-${usd(lead.annualHi)}`,
        `messages/${safe}.txt`, "pending",
      ]
        .map(csvEsc)
        .join(",")
    );
    n++;
    console.log(
      `  ✓  ${b.name}${dist != null ? ` (${dist.toFixed(0)} mi)` : ""} -> ${lead.tabs}` +
        `${contact.contact_form_url ? " [form]" : contact.email ? " [email]" : " [no channel found]"}`
    );
  }

  await writeFile(`${dir}/kit.csv`, csv.join("\n") + "\n");
  console.log(
    `\nDone. ${n} message(s) -> ${dir}/ (kit.csv + messages/). NOTHING was sent — paste via each` +
      ` company's contact form (or email), and update the status column as replies come in.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
