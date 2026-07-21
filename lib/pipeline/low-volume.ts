// "Healthy system delivering zero" tripwire (2026-07-17 lesson: commercial
// sends decayed 45→45→25→18→0 across a week of green cron runs and nothing
// told the operator — the failure alerts only cover THROWN errors, but the
// launch-day failure mode was every run succeeding while volume starved).
// After an engine's LAST run of the day, if sends finished far under cap,
// page the operator once. Volume is the signal; green runs are not.

import { db } from "../db";
import { usageCounter } from "../db/schema";
import { alertOperatorOfLowVolume } from "../email/operator-alerts";

/** Sent-vs-cap ratio below which a finished day is alert-worthy. */
export const LOW_VOLUME_RATIO = 0.2;

/** Pure: does this day's outcome warrant the page? */
export function isLowVolume(sent: number, cap: number): boolean {
  return cap > 0 && sent < Math.ceil(cap * LOW_VOLUME_RATIO);
}

/**
 * Call at the end of every engine invocation. Fires only when (a) the
 * autopilot actually sends (a dry-run day is zero by design), (b) the day's
 * final scheduled run has happened (`lastRunHourUtc`), (c) volume is under
 * LOW_VOLUME_RATIO of cap, and (d) no alert went out for this engine today
 * (usage-counter marker). Best-effort — never breaks the cron.
 */
export async function maybeLowVolumeAlert(o: {
  engine: string;
  sent: number;
  cap: number;
  /** UTC hour of the engine's last scheduled run of the day. */
  lastRunHourUtc: number;
  enabled: boolean;
  hint: string;
}): Promise<void> {
  try {
    if (!o.enabled) return;
    if (new Date().getUTCHours() < o.lastRunHourUtc) return;
    if (!isLowVolume(o.sent, o.cap)) return;
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const marker = await db
      .insert(usageCounter)
      .values({ key: `lowvol:${o.engine}`, window_start: day, count: 1 })
      .onConflictDoNothing({ target: [usageCounter.key, usageCounter.window_start] })
      .returning();
    if (marker.length === 0) return; // already paged today
    await alertOperatorOfLowVolume({ engine: o.engine, sent: o.sent, cap: o.cap, hint: o.hint });
  } catch (e) {
    console.error("low-volume tripwire failed (engine run unaffected):", e);
  }
}
