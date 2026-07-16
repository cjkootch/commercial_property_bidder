// Guards for /api/claim/track — the arms race with link scanners, round 3.
// Round 1 (UA sniffing) lost to UA spoofing; round 2 (JS-gating) lost to
// headless browsers; round 3 (input-gating, #255) lost to input-SIMULATING
// appliances (2026-07-16: Walton Roofing's appliance clicked the nudge,
// visited a stale link, then opened the fresh one TWICE 24ms apart). These
// pure guards encode what those appliances still can't fake convincingly:
//   - a human doesn't load the same page twice within seconds (double-fire)
//   - a human holds ONE company's link; a scanner walks MANY (cross-token)
//   - a human dwells before acting; an appliance races (client-side dwell)

import crypto from "node:crypto";

/** Minimum ms a visitor must have had the page open before the tracking POST
 *  counts. Enforced client-side (the POST carries dwellMs) and checked here —
 *  a forged high dwell still has to pass the cross-token and dedupe guards. */
export const TRACK_MIN_DWELL_MS = 1500;

/** Salted, truncated IP hash — enough to correlate a scanning appliance
 *  across requests, useless for identifying a person. */
export function hashIp(ip: string | null | undefined, salt: string): string | null {
  if (!ip) return null;
  return crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 24);
}

export type RecentEvent = {
  company: string | null;
  property_id: string | null;
  event: string;
  ip_hash: string | null;
  created_at: Date;
};

/** Same company+property+event again within the window = a double page load
 *  (24ms apart in the wild), not a second visit. */
export function isDuplicateFire(
  recent: RecentEvent[],
  e: { company: string | null; propertyId: string | null; event: string },
  now: Date,
  windowMs = 10_000
): boolean {
  return recent.some(
    (r) =>
      r.event === e.event &&
      (r.company ?? "") === (e.company ?? "") &&
      (r.property_id ?? "") === (e.propertyId ?? "") &&
      now.getTime() - r.created_at.getTime() < windowMs
  );
}

/** One IP producing events for a DIFFERENT company's token within the window
 *  is a machine walking a link list — no human holds two companies' claim
 *  links. (view_expired rows count: stale-link visits are the tell.) */
export function isCrossTokenScanner(
  recent: RecentEvent[],
  e: { ipHash: string | null; company: string | null },
  now: Date,
  windowMs = 10 * 60_000
): boolean {
  if (!e.ipHash) return false;
  return recent.some(
    (r) =>
      r.ip_hash === e.ipHash &&
      now.getTime() - r.created_at.getTime() < windowMs &&
      (r.company ?? null) !== (e.company ?? null)
  );
}
