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
  lead: SizedLead;
  brand: string;
  replyEmail: string;
  price: number;
}): string {
  const { lead } = o;
  return `Hi ${o.company} team,

A ${lead.cost} commercial development is getting underway${o.distClause}${lead.city ? ` (${lead.city} area)` : ""}, with ground breaking around ${lead.start}.

Once it's complete, it will need year-round grounds maintenance. We've already measured the site from the air: roughly ${lead.turf.toLocaleString()} sq ft of maintainable turf — an estimated ${usd(lead.annualLo)}–${usd(lead.annualHi)}/yr contract.

We package opportunities like this into complete job sheets: the exact location, the owner and architect to contact, our site measurement, crew-hour sizing, and the right window to bid. YOUR FIRST SHEET IS FREE — reply to this message or email ${o.replyEmail} and it's yours, no strings attached.

— ${o.brand}
${o.replyEmail} · after the free one, sheets are $${o.price} each and sold to one company only
`;
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
  const leadRows = await db
    .select()
    .from(schema.property)
    .where(like(schema.property.name, "%(TABS %"))
    .orderBy(desc(schema.property.created_at));
  const leads: SizedLead[] = [];
  for (const p of leadRows) {
    const parcel = p.parcel_geojson as ParcelResult | null;
    if (!parcel || p.lat == null || p.lng == null) continue;
    try {
      const s = await sizeLead(parcel, token!, cfg);
      leads.push({
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
  buyers = buyers.slice(0, MAX_BUYERS);
  if (!buyers.length) throw new Error("No buyers (set APOLLO_API_KEY or provide campaign/buyers.csv).");

  const stamp = new Date().toISOString().slice(0, 10);
  const dir = `campaign/${stamp}`;
  await mkdir(`${dir}/messages`, { recursive: true });

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
    const distClause = dist != null ? ` about ${Math.max(1, Math.round(dist))} ${Math.round(dist) <= 1 ? "mile" : "miles"} from your office` : " in your service area";

    const contact = b.website ? await scrapeBusinessContact(b.website) : { email: null, phone: null, contact_form_url: null };

    const msg = message({ company: b.name, distClause, lead, brand: co.name, replyEmail, price: PRICE });
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
