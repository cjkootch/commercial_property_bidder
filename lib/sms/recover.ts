// Bounce-driven number recovery. When an opener carrier-rejects (Twilio status
// failed/undelivered), the number on file is a dead end — a landline we
// mis-kept, a bad scrape, a disconnected line. Rather than blanket-re-enrich
// the whole book, we react to a PROVEN bounce: find the company, try to source
// a better mobile (Apollo mobile reveal first, website scrape as fallback),
// and if we find a real, different, textable number, swap it in and reset the
// line-type cache so it re-screens and can re-enter the opener queue.
//
// Attempt-once: prospect_company.phone_recovery_at is stamped on every attempt
// so a company with no recoverable mobile isn't reprocessed each run.

import { and, isNotNull, isNull, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { prospectCompany, smsSend } from "@/lib/db/schema";
import { toE164 } from "@/lib/integrations/twilio";
import { findOwnerMobile } from "@/lib/integrations/apollo";
import { scrapeBusinessContact } from "@/lib/integrations/contact";

/** Phones whose MOST RECENT outbound SMS terminally failed. Latest-wins so a
 *  number that later got through (a manual retry that delivered) is not
 *  treated as bounced. Pure — takes the send ledger, returns the dead set. */
export function selectBouncedPhones(
  sends: Array<{ direction: string; phone: string; status?: string | null; created_at: Date }>
): Set<string> {
  const latest = new Map<string, { t: number; status: string }>();
  for (const s of sends) {
    if (s.direction !== "out") continue;
    const t = s.created_at.getTime();
    const prev = latest.get(s.phone);
    if (!prev || t > prev.t) latest.set(s.phone, { t, status: s.status ?? "" });
  }
  const bounced = new Set<string>();
  for (const [phone, v] of latest) {
    if (v.status === "failed" || v.status === "undelivered") bounced.add(phone);
  }
  return bounced;
}

export type RecoverSummary = {
  bouncedPhones: number;
  attempted: number;
  recovered: number;
  swaps: Array<{ company: string; from: string; to: string; via: "apollo" | "scrape" }>;
};

/** Source a better mobile for one company: Apollo mobile reveal, then a
 *  website scrape. Returns a NEW E.164 that differs from the bounced number,
 *  or null. The website scrape is a weak fallback (it re-surfaces the same
 *  published main line) but occasionally a sole-prop's cell is the listed one. */
async function findReplacement(
  company: { name: string; website: string | null },
  bounced: string
): Promise<{ phone: string; via: "apollo" | "scrape" } | null> {
  const apollo = toE164(await findOwnerMobile(company.name, { domain: company.website }));
  if (apollo && apollo !== bounced) return { phone: apollo, via: "apollo" };
  if (company.website) {
    const scraped = toE164((await scrapeBusinessContact(company.website)).phone);
    if (scraped && scraped !== bounced) return { phone: scraped, via: "scrape" };
  }
  return null;
}

/** Find companies whose current number bounced and hasn't been recovery-tried,
 *  attempt a swap, and (when apply) persist it. Sequential — Apollo reveal is a
 *  paid, rate-limited call and volume is bounded by real bounces. */
export async function recoverBouncedNumbers(opts: {
  apply: boolean;
  limit: number;
}): Promise<RecoverSummary> {
  const [sends, companies] = await Promise.all([
    db
      .select({ direction: smsSend.direction, phone: smsSend.phone, status: smsSend.status, created_at: smsSend.created_at })
      .from(smsSend),
    db
      .select({
        id: prospectCompany.id,
        name: prospectCompany.name,
        phone: prospectCompany.phone,
        website: prospectCompany.website,
      })
      .from(prospectCompany)
      .where(
        and(
          isNotNull(prospectCompany.phone),
          isNull(prospectCompany.phone_recovery_at),
          isNull(prospectCompany.blocked_at),
          isNull(prospectCompany.buyer_id)
        )
      ),
  ]);

  const bounced = selectBouncedPhones(sends);
  const targets = companies
    .map((c) => ({ ...c, e164: toE164(c.phone) }))
    .filter((c) => c.e164 && bounced.has(c.e164))
    .slice(0, opts.limit);

  const summary: RecoverSummary = {
    bouncedPhones: bounced.size,
    attempted: 0,
    recovered: 0,
    swaps: [],
  };

  for (const c of targets) {
    summary.attempted++;
    const repl = await findReplacement(c, c.e164!);
    if (opts.apply) {
      if (repl) {
        // New number: swap it in and wipe the line-type verdict so the JIT
        // screen re-runs Lookup before it's texted (it must re-earn textable).
        await db
          .update(prospectCompany)
          .set({
            phone: repl.phone,
            line_type: null,
            line_type_checked_at: null,
            phone_recovery_at: new Date(),
          })
          .where(eq(prospectCompany.id, c.id))
          .catch((e) => console.error("recovery swap failed:", e));
      } else {
        // Nothing found — stamp the attempt so we don't retry this company.
        await db
          .update(prospectCompany)
          .set({ phone_recovery_at: new Date() })
          .where(eq(prospectCompany.id, c.id))
          .catch((e) => console.error("recovery mark failed:", e));
      }
    }
    if (repl) {
      summary.recovered++;
      summary.swaps.push({ company: c.name, from: c.e164!, to: repl.phone, via: repl.via });
    }
  }
  return summary;
}
