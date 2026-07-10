// New-market probe kit: runs the mechanical checks of the expansion playbook
// (docs/EXPANSION.md) against a candidate metro and prints a readiness
// report. PUBLIC ENDPOINTS ONLY — no database, no credentials, no writes.
// The judgment calls (parcel quirks, gate decisions, bbox) stay human; this
// automates the hour of probing that precedes them.
//
// Run: npm run probe:market -- --name "Corpus Christi" --counties "NUECES" \
//        --cities "Corpus Christi,Portland" [--slugs extraslug1,extraslug2]
//
// Checks, mirroring how the live markets were opened (verified patterns
// 2026-07): LGBS tax-sale pipeline count per county; TABC pending
// applications per county; Bonfire portal discovery by slug fuzzing; county
// parcel-layer discovery via the ArcGIS Online catalog with field
// classification (owner / PTAD class / value / acreage / deed date) and
// deed-date freshness measurement.

type Args = { name: string; counties: string[]; cities: string[]; slugs: string[] };

function parseArgs(): Args {
  const get = (flag: string) => {
    const i = process.argv.indexOf(flag);
    return i !== -1 ? process.argv[i + 1] : undefined;
  };
  const name = get("--name");
  const counties = (get("--counties") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!name || !counties.length) {
    console.error(
      'Usage: npm run probe:market -- --name "Metro" --counties "COUNTY1,COUNTY2" [--cities "City1,City2"] [--slugs a,b]'
    );
    process.exit(1);
  }
  return {
    name,
    counties: counties.map((c) => c.toUpperCase().replace(/\s+COUNTY$/, "")),
    cities: (get("--cities") ?? name).split(",").map((s) => s.trim()).filter(Boolean),
    slugs: (get("--slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

async function fetchJson(url: string, ms = 15000): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- 1. LGBS tax-sale pipeline -------------------------------------------
async function probeLgbs(county: string): Promise<number | null> {
  const d = (await fetchJson(
    `https://taxsales.lgbs.com/api/property_sales/?county=${encodeURIComponent(`${county} COUNTY`)}&state=TX&limit=1&offset=0`
  )) as { count?: number } | null;
  return d?.count ?? null;
}

// ---- 2. TABC pending applications ----------------------------------------
async function probeTabc(counties: string[]): Promise<Map<string, number>> {
  const inList = counties.map((c) => `'${c.toUpperCase()}'`).join(",");
  const url =
    "https://data.texas.gov/resource/mxm5-tdpj.json?" +
    new URLSearchParams({
      $where: `upper(county) in(${inList})`,
      $select: "county,count(*)",
      $group: "county",
    }).toString();
  const rows = (await fetchJson(url)) as { county?: string; count?: string }[] | null;
  const out = new Map<string, number>();
  for (const r of rows ?? []) if (r.county) out.set(r.county.toUpperCase(), Number(r.count ?? 0));
  return out;
}

// ---- 3. Bonfire portal discovery ------------------------------------------
function slugCandidates(a: Args): string[] {
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const set = new Set<string>(a.slugs.map(squash));
  for (const city of a.cities) {
    const c = squash(city);
    for (const s of [c, `${c}tx`, `${c}texas`, `cityof${c}`, `${c}isd`]) set.add(s);
  }
  for (const county of a.counties) {
    const c = squash(county);
    for (const s of [c, `${c}county`, `${c}countytx`, `${c}cad`]) set.add(s);
  }
  return [...set];
}

async function probeBonfire(slug: string): Promise<{ open: number; title: string } | null> {
  const d = (await fetchJson(
    `https://${slug}.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData`,
    8000
  )) as { success?: number; payload?: { projects?: Record<string, unknown> } } | null;
  if (!d || d.success !== 1) return null;
  // Portal title names the agency (slug alone can be ambiguous statewide).
  let title = slug;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://${slug}.bonfirehub.com/portal`, { signal: controller.signal });
    const html = await res.text();
    clearTimeout(t);
    title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/Portal — Open Opportunities - /, "") ?? slug;
  } catch {
    // keep slug as title
  }
  return { open: Object.keys(d.payload?.projects ?? {}).length, title };
}

// ---- 4. Parcel-layer discovery via the AGOL catalog ------------------------
type LayerReport = {
  title: string;
  owner: string;
  url: string;
  count: number | null;
  hasOwner: boolean;
  hasClass: boolean;
  hasValue: boolean;
  hasAcres: boolean;
  deedField: string | null;
  deedFieldType: string | null;
  deedSince180d: number | null;
  agolHosted: boolean;
};

const FIELD_SIGNALS = {
  owner: /owner|file_as_name|py_owner|partyname/i,
  class: /state_c|land_state|state_cd/i,
  value: /market|tot_?val|totalvalue|appraised|total_valu/i,
  acres: /acre/i,
  deed: /deed_?date|new_owner_date|deeddate|saledate|sale_date/i,
};

async function probeLayer(title: string, owner: string, url: string): Promise<LayerReport | null> {
  const info = (await fetchJson(`${url}?f=json`)) as
    | { fields?: { name: string; type: string }[]; layers?: { id: number }[] }
    | null;
  let layerUrl = url;
  let fields = info?.fields;
  if (!fields && info?.layers?.length) {
    layerUrl = `${url}/${info.layers[0].id}`;
    const sub = (await fetchJson(`${layerUrl}?f=json`)) as { fields?: { name: string; type: string }[] } | null;
    fields = sub?.fields;
  }
  if (!fields?.length) return null;
  const names = fields.map((f) => f.name);
  const deed = fields.find((f) => FIELD_SIGNALS.deed.test(f.name)) ?? null;
  const countRes = (await fetchJson(
    `${layerUrl}/query?where=1%3D1&returnCountOnly=true&f=json`
  )) as { count?: number } | null;

  let deedSince180d: number | null = null;
  if (deed && /Date/i.test(deed.type)) {
    const since = new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10);
    const today = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    const d = (await fetchJson(
      `${layerUrl}/query?` +
        new URLSearchParams({
          where: `${deed.name} >= DATE '${since}' AND ${deed.name} <= DATE '${today}'`,
          returnCountOnly: "true",
          f: "json",
        }).toString()
    )) as { count?: number } | null;
    deedSince180d = d?.count ?? null;
  }
  return {
    title,
    owner,
    url: layerUrl,
    count: countRes?.count ?? null,
    hasOwner: names.some((n) => FIELD_SIGNALS.owner.test(n)),
    hasClass: names.some((n) => FIELD_SIGNALS.class.test(n)),
    hasValue: names.some((n) => FIELD_SIGNALS.value.test(n)),
    hasAcres: names.some((n) => FIELD_SIGNALS.acres.test(n)),
    deedField: deed?.name ?? null,
    deedFieldType: deed?.type ?? null,
    deedSince180d,
    agolHosted: /services\d*\.arcgis\.com/.test(url),
  };
}

async function probeParcels(county: string): Promise<LayerReport[]> {
  const q = encodeURIComponent(`${county} county parcels texas type:"Feature Service"`);
  const search = (await fetchJson(
    `https://www.arcgis.com/sharing/rest/search?q=${q}&num=15&f=json`
  )) as { results?: { title?: string; owner?: string; url?: string; type?: string }[] } | null;
  const seen = new Set<string>();
  const out: LayerReport[] = [];
  for (const r of search?.results ?? []) {
    if (!r.url || seen.has(r.url)) continue;
    seen.add(r.url);
    if (!/FeatureServer|MapServer/.test(r.url)) continue;
    const rep = await probeLayer(r.title ?? "?", r.owner ?? "?", r.url);
    if (rep && (rep.count ?? 0) > 10_000) out.push(rep); // county-scale only
  }
  return out.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
}

// ---- report ----------------------------------------------------------------
async function main() {
  const args = parseArgs();
  console.log(`\n# Market probe: ${args.name}`);
  console.log(`Counties: ${args.counties.join(", ")} | ${new Date().toISOString().slice(0, 10)}\n`);

  console.log("## Tax sales (LGBS)");
  for (const c of args.counties) {
    const n = await probeLgbs(c);
    console.log(`  ${c}: ${n === null ? "UNREACHABLE" : `${n} in pipeline ${n > 0 ? "— GO" : "— not carried (different tax firm)"}`}`);
  }

  console.log("\n## TABC pending applications");
  const tabc = await probeTabc(args.counties);
  for (const c of args.counties) {
    const n = tabc.get(c) ?? 0;
    console.log(`  ${c}: ${n} pending ${n > 0 ? "— GO" : ""}`);
  }

  console.log("\n## Bonfire RFP portals (slug fuzz — verify titles!)");
  let found = 0;
  for (const slug of slugCandidates(args)) {
    const r = await probeBonfire(slug);
    if (r) {
      found++;
      console.log(`  ✓ ${slug} — "${r.title}" (${r.open} open now)`);
    }
  }
  if (!found) console.log("  none found — try agency-specific slugs (ISDs, transit, utilities)");

  console.log("\n## Parcel layers (AGOL catalog — county-scale candidates)");
  for (const c of args.counties) {
    console.log(`  ${c}:`);
    const layers = await probeParcels(c);
    if (!layers.length) console.log("    none found in the catalog — probe the CAD/county GIS site directly");
    for (const l of layers.slice(0, 4)) {
      const feats = [
        l.hasOwner ? "owner" : null,
        l.hasClass ? "PTAD-class" : "NO-class",
        l.hasValue ? "value" : null,
        l.hasAcres ? "acres" : null,
        l.deedField ? `deed:${l.deedField}(${l.deedFieldType?.replace("esriFieldType", "")})` : null,
      ]
        .filter(Boolean)
        .join(", ");
      console.log(`    ${l.count?.toLocaleString()} parcels | ${feats}${l.agolHosted ? "" : " | ⚠ non-AGOL host (verify Vercel reachability)"}`);
      console.log(`      ${l.title} (${l.owner})`);
      console.log(`      ${l.url}`);
      if (l.deedSince180d !== null)
        console.log(`      deed freshness: ${l.deedSince180d} deeds in the last 180d ${l.deedSince180d > 100 ? "— residential potential" : "— stale/roll-lagged"}`);
    }
  }

  console.log(
    "\nRemaining human steps: pick the parcel layer + write its normalizer (expect quirks:\n" +
      "sentinel dates, zeroed fields, padded strings, attribute-query caps), set the bbox\n" +
      "(check MSA overlap with existing markets), registry entry + crons, live-run verify."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
