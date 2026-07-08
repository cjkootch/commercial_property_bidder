// Shared reject memory for the sourcing feeds: screened-and-rejected
// candidates are remembered so the next run's attempt budget reaches fresh
// supply instead of re-buying the same imagery screens every week.

import { db } from "../db";
import { sourcingReject } from "../db/schema";

/** All reject keys (small table, full load is fine). */
export async function loadRejects(): Promise<Set<string>> {
  const rows = await db.select({ key: sourcingReject.key }).from(sourcingReject);
  return new Set(rows.map((r) => r.key));
}

export async function recordReject(key: string, reason: string): Promise<void> {
  await db.insert(sourcingReject).values({ key, reason }).onConflictDoNothing({ target: sourcingReject.key });
}
