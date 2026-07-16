// ATTOM Data property enrichment — METERED. The trial is 1,000 calls in 30
// days, and post-trial pricing starts at $600/mo for 5k calls, so every call
// must trace to product value. Three rules enforced here, not by caller
// discipline:
//   1. Hard ledgers before every HTTP call: a lifetime trial cap (attom:trial,
//      default 950 — headroom below 1,000) and a daily brake (attom:day) so a
//      bug can't drain the trial overnight.
//   2. Cache forever: callers go through ensurePropertyAttom, which fetches at
//      most once per property EVER — misses too (a no-data address must not
//      cost a second call).
//   3. One endpoint that earns the spend: /property/expandedprofile bundles
//      assessor owner + mailing, assessed/market value, building size, year
//      built, and last sale in a single call.
// Env: ATTOM_API_KEY — or PARCEL_VENDOR_API_KEY, the name it carries in the
// Vercel project (+ optional ATTOM_TRIAL_CAP, ATTOM_DAILY_CAP).

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { property, residentialLead, usageCounter } from "../db/schema";
import { rateLimit, windowStart } from "../ratelimit";
import { marketForCoords } from "../markets";

const BASE = "https://api.gateway.attomdata.com/propertyapi/v1.0.0";

export const ATTOM_TRIAL_CAP = () => Number(process.env.ATTOM_TRIAL_CAP) || 950;
// 40/day leaves room for a package publish (16–45 leads) plus the day's
// claims while still capping a runaway bug at ~4% of the trial per day.
export const ATTOM_DAILY_CAP = () => Number(process.env.ATTOM_DAILY_CAP) || 40;
/** ~13 months — one fixed window that outlives the trial, so the lifetime
 *  ledger can't silently reset mid-trial the way a 30d window could. */
const TRIAL_WINDOW_SEC = 400 * 86_400;

export function getAttomKey(): string | null {
  return process.env.ATTOM_API_KEY ?? process.env.PARCEL_VENDOR_API_KEY ?? null;
}

/** Normalized keeper-fields from /property/expandedprofile. status "ok" =
 *  facts present; "none" = ATTOM had nothing for the address (cached so the
 *  miss is never re-bought); "error" = transient failure (NOT cached). */
export type AttomFacts = {
  status: "ok" | "none";
  owner: string | null;
  owner_mailing: string | null;
  /** Assessor's absentee flag: true = absentee owner, false = owner occupied,
   *  null = unstated. High-signal for residential (absentee = landlord). */
  absentee?: boolean | null;
  /** Assessor total assessed value, USD. */
  assessed_value: number | null;
  /** Assessor total market value, USD. */
  market_value: number | null;
  building_sqft: number | null;
  lot_sqft: number | null;
  year_built: number | null;
  property_type: string | null;
  last_sale_date: string | null;
  last_sale_price: number | null;
  fetched_at: string;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/** ATTOM's field casing is inconsistent across endpoints and vintages
 *  (assdTtlValue vs assdttlvalue — a live day-one bug: the camelCase real
 *  response slipped straight through lowercase paths and reported rich
 *  records as empty). Lowercase every key once, then read lowercase paths. */
export function lcKeys(v: any): any {
  if (Array.isArray(v)) return v.map(lcKeys);
  if (v && typeof v === "object") {
    const out: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) out[k.toLowerCase()] = lcKeys(val);
    return out;
  }
  return v;
}

function ownerName(o: any): string | null {
  if (!o) return null;
  const names = [o.owner1, o.owner2, o.owner3, o.owner4]
    .map((x) => {
      if (!x) return null;
      const full =
        (x.fullname as string | undefined) ||
        [x.firstnameandmi, x.lastname].filter(Boolean).join(" ").trim();
      return full || null;
    })
    .filter(Boolean) as string[];
  if (!names.length) return null;
  return names.slice(0, 2).join(" & ");
}

/** Defensive pick over ATTOM's deeply-nested response. Every path optional —
 *  commercial parcels frequently omit whole branches. */
export function normalizeExpandedProfile(json: any): AttomFacts | null {
  const raw = json?.property?.[0];
  if (!raw) return null;
  const p = lcKeys(raw);
  const owner = p.assessment?.owner ?? null;
  const mailing = owner?.mailingaddressoneline ?? null;
  // "A" = absentee owner, "O" = owner occupied (assessor's own flag beats any
  // zip heuristic). Falls back to the summary indicator string.
  const abs = owner?.absenteeownerstatus ?? null;
  const absInd = p.summary?.absenteeind ? String(p.summary.absenteeind) : null;
  const absentee =
    abs === "A" ? true : abs === "O" ? false : absInd ? /absentee/i.test(absInd) : null;
  return {
    status: "ok",
    owner: ownerName(owner),
    owner_mailing: mailing ? String(mailing) : null,
    absentee,
    assessed_value: num(p.assessment?.assessed?.assdttlvalue),
    market_value: num(p.assessment?.market?.mktttlvalue),
    building_sqft:
      num(p.building?.size?.universalsize) ??
      num(p.building?.size?.bldgsize) ??
      num(p.building?.size?.grosssize),
    lot_sqft: num(p.lot?.lotsize2) ?? (num(p.lot?.lotsize1) ? num(p.lot.lotsize1)! * 43_560 : null),
    year_built: num(p.summary?.yearbuilt),
    property_type: p.summary?.proptype ? String(p.summary.proptype) : null,
    last_sale_date: p.sale?.saletransdate ? String(p.sale.saletransdate) : null,
    last_sale_price: num(p.sale?.amount?.saleamt),
    fetched_at: new Date().toISOString(),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type AttomResult =
  | { ok: true; facts: AttomFacts }
  | { ok: false; error: string; budget?: boolean };

export type AttomGetResult =
  | { ok: true; json: unknown; noResult: boolean }
  | { ok: false; error: string; budget?: boolean };

/** The ONE metered GET every ATTOM endpoint goes through. Ledgers are counted
 *  BEFORE the HTTP call — an over-budget request is refused without spending.
 *  `noResult: true` = ATTOM's SuccessWithoutResult (a real "nothing here"
 *  answer, often delivered as HTTP 400). */
export async function attomGet(path: string, params: Record<string, string>): Promise<AttomGetResult> {
  const key = getAttomKey();
  if (!key) return { ok: false, error: "ATTOM_API_KEY not set" };

  const trial = await rateLimit("attom:trial", ATTOM_TRIAL_CAP(), TRIAL_WINDOW_SEC);
  if (!trial.ok) return { ok: false, error: `trial call budget exhausted (${trial.count})`, budget: true };
  const day = await rateLimit("attom:day", ATTOM_DAILY_CAP(), 86_400);
  if (!day.ok) return { ok: false, error: "daily ATTOM brake tripped", budget: true };

  try {
    const sp = new URLSearchParams(params);
    const res = await fetch(`${BASE}${path}?${sp.toString()}`, {
      headers: { apikey: key, Accept: "application/json" },
    });
    const json = (await res.json().catch(() => null)) as {
      status?: { code?: number; msg?: string };
    } | null;
    const msg = json?.status?.msg ?? "";
    if (/SuccessWithoutResult/i.test(msg) || res.status === 404) {
      return { ok: true, json, noResult: true };
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${msg}`.trim() };
    return { ok: true, json, noResult: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "attom fetch failed" };
  }
}

export async function fetchExpandedProfile(address1: string, address2: string): Promise<AttomResult> {
  const res = await attomGet("/property/expandedprofile", { address1, address2 });
  if (!res.ok) return res;
  if (res.noResult) return { ok: true, facts: emptyFacts() };
  const facts = normalizeExpandedProfile(res.json);
  return facts ? { ok: true, facts } : { ok: true, facts: emptyFacts() };
}

function emptyFacts(): AttomFacts {
  return {
    status: "none",
    owner: null,
    owner_mailing: null,
    absentee: null,
    assessed_value: null,
    market_value: null,
    building_sqft: null,
    lot_sqft: null,
    year_built: null,
    property_type: null,
    last_sale_date: null,
    last_sale_price: null,
    fetched_at: new Date().toISOString(),
  };
}

type PropertyForAttom = {
  id: string;
  address: string | null;
  city: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  attom: unknown;
  attom_fetched_at: Date | null;
};

/** The ONLY caller-facing entry point: cached facts if we ever fetched (hit or
 *  miss), otherwise one metered fetch, stored forever. Never throws; null =
 *  couldn't get facts this time (no key, over budget, transient error) and the
 *  property stays un-stamped so a later attempt may retry. */
export async function ensurePropertyAttom(p: PropertyForAttom): Promise<AttomFacts | null> {
  if (p.attom_fetched_at) {
    const cached = p.attom as AttomFacts | null;
    return cached && cached.status === "ok" ? cached : null;
  }
  if (!p.address || !p.city) return null;
  // No street number = no parcel identity. ATTOM will "helpfully" match some
  // other parcel on the road and return its owner (live incident, first day:
  // "Fairmont Pky" came back with a Plano mailing address contradicting the
  // county's). Wrong data on a sheet is worse than none — and it costs a call.
  if (!/^\d+\s/.test(p.address.trim())) return null;
  const market = marketForCoords(p.lat, p.lng);
  const state = market.state ?? "TX";
  const address2 = `${p.city}, ${state}${p.zip ? ` ${p.zip}` : ""}`;
  const res = await fetchExpandedProfile(p.address, address2);
  if (!res.ok) {
    if (!res.budget) console.error(`attom: ${res.error}`);
    return null;
  }
  await db
    .update(property)
    .set({ attom: res.facts, attom_fetched_at: new Date() })
    .where(eq(property.id, p.id))
    .catch((e) => console.error("attom cache write failed:", e));
  return res.facts.status === "ok" ? res.facts : null;
}

type ResidentialForAttom = {
  id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  attom: unknown;
  attom_fetched_at: Date | null;
};

/** Residential twin of ensurePropertyAttom — same metering, same
 *  cache-forever, keyed on residential_lead. Residential is where ATTOM
 *  earns it: owner names, real sale prices, and the absentee flag. */
export async function ensureResidentialAttom(r: ResidentialForAttom): Promise<AttomFacts | null> {
  if (r.attom_fetched_at) {
    const cached = r.attom as AttomFacts | null;
    return cached && cached.status === "ok" ? cached : null;
  }
  if (!r.address || !r.city) return null;
  if (!/^\d+\s/.test(r.address.trim())) return null;
  const address2 = `${r.city}, ${r.state ?? "TX"}${r.zip ? ` ${r.zip}` : ""}`;
  const res = await fetchExpandedProfile(r.address, address2);
  if (!res.ok) {
    if (!res.budget) console.error(`attom: ${res.error}`);
    return null;
  }
  await db
    .update(residentialLead)
    .set({ attom: res.facts, attom_fetched_at: new Date() })
    .where(eq(residentialLead.id, r.id))
    .catch((e) => console.error("attom residential cache write failed:", e));
  return res.facts.status === "ok" ? res.facts : null;
}

/** Trial spend so far (current ledger window), for the operator meter. */
export async function attomCallsUsed(): Promise<number> {
  try {
    const [row] = await db
      .select({ count: usageCounter.count })
      .from(usageCounter)
      .where(
        and(
          eq(usageCounter.key, "attom:trial"),
          eq(usageCounter.window_start, windowStart(TRIAL_WINDOW_SEC))
        )
      );
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

/** Human money for facts display. */
export function usdShort(n: number | null): string | null {
  if (n == null) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}
