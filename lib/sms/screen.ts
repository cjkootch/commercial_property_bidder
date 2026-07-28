// Line-type screening: keep landlines out of the text queue. Numbers come
// from Apollo enrichment + website scrapes and are usually the business MAIN
// line — frequently a landline/VoIP, not the owner's cell. Texting a landline
// wastes a daily-cap slot, gets carrier-rejected, and drags sender reputation.
//
// Twilio Lookup v2 (line_type_intelligence) resolves each number to
// mobile/voip/landline. We text mobile + VoIP, skip true landlines. The
// verdict is cached on prospect_company.line_type so we pay the ~$0.008
// lookup once per number, never per send. Fail-open: a lookup outage leaves
// the number "unknown" and still textable — a screen must never silence the
// whole queue.

import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { prospectCompany } from "@/lib/db/schema";
import { lookupLineType, toE164 } from "@/lib/integrations/twilio";

/** Screen ONE company's phone if it hasn't been screened yet, cache the
 *  verdict, and return the effective line type ("unknown" when the lookup is
 *  unavailable). A non-null `cached` short-circuits the paid lookup. */
export async function ensureLineTypeScreened(
  companyId: string,
  phone: string | null | undefined,
  cached: string | null | undefined
): Promise<string | null> {
  if (cached) return cached;
  const e164 = toE164(phone);
  if (!e164) return null; // not a dialable number; queue already drops these
  const type = await lookupLineType(e164);
  if (!type) return null; // lookup failed — leave unscreened, retry next time
  await db
    .update(prospectCompany)
    .set({ line_type: type, line_type_checked_at: new Date() })
    .where(eq(prospectCompany.id, companyId))
    .catch((e) => console.error("line_type cache failed:", e));
  return type;
}

export type ScreenSummary = {
  scanned: number;
  screened: number;
  byType: Record<string, number>;
  failed: number;
};

/** How stale an "unknown" verdict must be before it's worth paying to re-ask.
 *  Lookup's coverage improves and numbers get ported, so an unknown from weeks
 *  ago is not evidence about the number today. */
export const UNKNOWN_RECHECK_AFTER_DAYS =
  Number(process.env.UNKNOWN_RECHECK_AFTER_DAYS) || 14;

/** Backfill: screen up to `limit` phone-bearing, unblocked companies that are
 *  either never-screened OR carrying a stale "unknown" verdict. Sequential
 *  (Lookup is cheap but rate-limited; ordering keeps the spend legible in logs).
 *
 *  The "unknown" re-check exists because that verdict is now DISQUALIFYING
 *  (see isTextableLineType — those numbers ran 85.7% undelivered). Without a
 *  path back, one bad screening day would strand a company on the no-text list
 *  permanently, and 87 phone-only companies would be unreachable on every
 *  channel forever. A verdict that can condemn must be re-askable. */
export async function screenUnscreenedLines(limit: number): Promise<ScreenSummary> {
  const staleBefore = new Date(Date.now() - UNKNOWN_RECHECK_AFTER_DAYS * 86_400_000);
  const rows = await db
    .select({ id: prospectCompany.id, phone: prospectCompany.phone })
    .from(prospectCompany)
    .where(
      and(
        isNotNull(prospectCompany.phone),
        isNull(prospectCompany.blocked_at),
        or(
          isNull(prospectCompany.line_type),
          and(
            eq(prospectCompany.line_type, "unknown"),
            or(
              isNull(prospectCompany.line_type_checked_at),
              lt(prospectCompany.line_type_checked_at, staleBefore)
            )
          )
        )
      )
    )
    .limit(limit);

  const byType: Record<string, number> = {};
  let screened = 0;
  let failed = 0;
  for (const r of rows) {
    const type = await ensureLineTypeScreened(r.id, r.phone, null);
    if (!type) {
      failed++;
      continue;
    }
    screened++;
    byType[type] = (byType[type] ?? 0) + 1;
  }
  return { scanned: rows.length, screened, byType, failed };
}
