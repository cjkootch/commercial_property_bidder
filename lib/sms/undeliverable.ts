// Permanent SMS delivery failures — the SMS twin of the email suppression list.
//
// Twilio reports two failures that never become deliverable no matter how many
// times you retry:
//
//   30005  Unknown destination handset  — the number does not exist
//   30006  Landline or unreachable carrier — it cannot receive SMS at all
//
// Until this file existed the webhook stored the code on the send row and
// nothing read it, so every campaign rediscovered the same dead numbers. The
// cost was measured, not theoretical: 27.4% of all outbound undelivered, with
// hold_expiry spending 13 sends on 3 dead numbers and lead_alert 3 on one.
// Carriers throttle A2P senders well below that rate, so this was not just
// waste — it put the whole SMS channel at risk.
//
// NOT permanent, deliberately excluded:
//   30003  handset unreachable (off / out of range) — genuinely transient
//   30008  unknown error — no verdict, do not condemn a number on it
//   30034  A2P campaign not registered — OUR configuration problem, not theirs;
//          suppressing here would quietly delete the audience while the real
//          fix is registering the campaign.

import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { smsUndeliverable } from "@/lib/db/schema";

/** Verdicts that mean "this number will never receive SMS".
 *
 *  21211 is a SUBMIT-time rejection rather than a delivery failure: Twilio
 *  refuses the request outright because the destination isn't a valid number.
 *  It belongs here for the same reason as the others — it can never become
 *  true — and it is by far the loudest: 3,122 events in 30 days against 481
 *  logged sends, because a rejected send never wrote a row and so nothing
 *  remembered not to try again.
 *
 *  Deliberately NOT solved by tightening our own validator. isValidNanp
 *  accepts "+15333333333" and "+14285714285" (area/exchange both satisfy the
 *  NXX rule) and rejecting those needs the real NANP assignment list, which is
 *  data we would have to carry and keep current. Twilio already knows. Let it
 *  be the authority and record the answer — that is robust to every invalid
 *  number, not just the ones we thought to enumerate. */
export const PERMANENT_SMS_ERROR_CODES = new Set(["30005", "30006", "21211"]);

/** PURE. Should this failure condemn the number permanently? */
export function isPermanentFailure(errorCode: string | null | undefined): boolean {
  return !!errorCode && PERMANENT_SMS_ERROR_CODES.has(String(errorCode).trim());
}

const REASONS: Record<string, string> = {
  "30005": "unknown destination handset (number does not exist)",
  "30006": "landline or carrier cannot receive SMS",
  "21211": "not a valid destination number (rejected by Twilio at submit)",
};

/**
 * Record a permanent failure. Idempotent and concurrency-safe without a
 * transaction (the Neon HTTP driver has none): the unique index on `phone` plus
 * ON CONFLICT means two status callbacks racing on the same number produce one
 * row with an accurate count rather than a duplicate-key error.
 *
 * Best-effort by design — a webhook must still 2xx if this write fails, or
 * Twilio retries forever and we double-count.
 */
export async function recordSmsFailure(
  phone: string | null | undefined,
  errorCode: string | null | undefined
): Promise<boolean> {
  if (!phone || !isPermanentFailure(errorCode)) return false;
  const code = String(errorCode).trim();
  try {
    await db
      .insert(smsUndeliverable)
      .values({
        phone,
        error_code: code,
        reason: REASONS[code] ?? `carrier error ${code}`,
        fail_count: 1,
      })
      .onConflictDoUpdate({
        target: smsUndeliverable.phone,
        set: {
          fail_count: sql`${smsUndeliverable.fail_count} + 1`,
          last_failed_at: new Date(),
          error_code: code,
        },
      });
    return true;
  } catch (e) {
    console.error(`sms undeliverable write failed for ${phone}:`, e);
    return false;
  }
}

/** Bulk load for a send loop — one query instead of N. */
export async function loadUndeliverable(): Promise<Set<string>> {
  try {
    const rows = await db.select({ phone: smsUndeliverable.phone }).from(smsUndeliverable);
    return new Set(rows.map((r) => r.phone));
  } catch (e) {
    // Fail OPEN: a database blip must not silence the queue. The worst case is
    // one more wasted send, which is strictly better than sending nothing.
    console.error("loadUndeliverable failed, proceeding unfiltered:", e);
    return new Set();
  }
}

/** Single-number check for the one-off send paths. */
export async function isUndeliverable(phone: string | null | undefined): Promise<boolean> {
  if (!phone) return false;
  try {
    const rows = await db
      .select({ id: smsUndeliverable.id })
      .from(smsUndeliverable)
      .where(eq(smsUndeliverable.phone, phone))
      .limit(1);
    return rows.length > 0;
  } catch {
    return false; // fail open, as above
  }
}

/**
 * Clear the verdict. A number that texts US is demonstrably alive — the lookup
 * was wrong, the line was ported, or the handset came back. This is the reason
 * deliverability is kept out of sms_opt_out: a STOP must never be undone by an
 * inbound message, but an "unreachable" verdict absolutely should be.
 */
export async function clearUndeliverable(phones: string[]): Promise<void> {
  if (!phones.length) return;
  try {
    await db.delete(smsUndeliverable).where(inArray(smsUndeliverable.phone, phones));
  } catch (e) {
    console.error("clearUndeliverable failed:", e);
  }
}
