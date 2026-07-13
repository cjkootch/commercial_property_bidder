// Cell-first: lead with the owner's mobile before the first SMS touch. A text
// to a business main line reaches a receptionist or nobody; the decision-
// maker's cell is where a first-touch SMS actually lands. So at queue time,
// for a candidate whose number isn't a confirmed mobile, we try an Apollo
// mobile reveal (findOwnerMobile) and swap the cell in — resetting the
// line-type cache so the new number re-screens before it's texted.
//
// Cost control: the reveal is a paid Apollo credit, so it's attempt-once per
// company (prospect_company.cell_lookup_at) and only runs for candidates the
// queue is about to text (bounded by the daily cap), never the whole book.
// SMS_CELL_REVEAL=0 disables it entirely (falls back to the number on file).

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { prospectCompany } from "@/lib/db/schema";
import { toE164 } from "@/lib/integrations/twilio";
import { findOwnerMobile } from "@/lib/integrations/apollo";

/** Re-reveal window: once we've looked, don't pay again for ~90 days (a person
 *  who had no Apollo cell rarely gains one week to week). */
export const CELL_LOOKUP_MAX_AGE_DAYS = 90;

/** Skip the paid reveal when we already hold a confirmed mobile, or we already
 *  looked recently. Pure — decides spend without touching Apollo or the DB. */
export function shouldRevealCell(
  lineType: string | null | undefined,
  cellLookupAt: Date | null | undefined,
  now: Date
): boolean {
  if (lineType === "mobile") return false; // already a cell — nothing to gain
  if (cellLookupAt && now.getTime() - cellLookupAt.getTime() < CELL_LOOKUP_MAX_AGE_DAYS * 86_400_000) {
    return false; // looked recently; don't re-spend
  }
  return true;
}

export type OwnerCellResult = { phone: string; lineType: string | null; swapped: boolean };

/**
 * Ensure a queue candidate leads with the owner's cell where we can find one.
 * Returns the number to actually text (a found mobile, else the one on file)
 * plus whether a swap happened (so the caller re-screens the fresh number).
 * Never throws; a reveal miss just stamps the attempt and keeps the current
 * number. Honors SMS_CELL_REVEAL=0 and apply=false (dry characterization).
 */
export async function ensureOwnerCell(
  c: {
    id: string;
    name: string;
    website: string | null;
    phone: string;
    lineType: string | null;
    cellLookupAt: Date | null;
  },
  opts: { apply: boolean; now?: Date }
): Promise<OwnerCellResult> {
  const now = opts.now ?? new Date();
  if (process.env.SMS_CELL_REVEAL === "0" || !shouldRevealCell(c.lineType, c.cellLookupAt, now)) {
    return { phone: c.phone, lineType: c.lineType, swapped: false };
  }
  const cell = toE164(await findOwnerMobile(c.name, { domain: c.website }));
  const current = toE164(c.phone);
  const found = cell && cell !== current ? cell : null;

  if (opts.apply) {
    if (found) {
      await db
        .update(prospectCompany)
        .set({ phone: found, line_type: null, line_type_checked_at: null, cell_lookup_at: now })
        .where(eq(prospectCompany.id, c.id))
        .catch((e) => console.error("cell swap failed:", e));
    } else {
      await db
        .update(prospectCompany)
        .set({ cell_lookup_at: now })
        .where(eq(prospectCompany.id, c.id))
        .catch((e) => console.error("cell mark failed:", e));
    }
  }

  return found
    ? { phone: found, lineType: null, swapped: true }
    : { phone: c.phone, lineType: c.lineType, swapped: false };
}
