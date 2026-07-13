import { NextRequest } from "next/server";
import { eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { pendingSms } from "@/lib/db/schema";
import { sendSms, isSmsOptedOut } from "@/lib/integrations/twilio";
import { withinTcpaHours } from "@/lib/sms/queue";

// Flush the TCPA quiet-hours defer queue. An inbound outside 8am–9pm parks its
// drafted AI reply in pending_sms; this cron sends each one the moment the
// recipient's local window opens. Runs across the morning (see vercel.json) so
// every metro's 8am is covered. Re-checks opt-out at send time (they may have
// STOP'd overnight). Idempotent: sent_at gates a row from ever going twice.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const now = new Date();
  const rows = await db.select().from(pendingSms).where(isNull(pendingSms.sent_at)).limit(200);

  let sent = 0;
  let held = 0;
  let dropped = 0;
  for (const r of rows) {
    // Not their window yet — leave it for a later run.
    if (!withinTcpaHours(now, r.tz)) {
      held++;
      continue;
    }
    // Opted out overnight → drop it (stamp so it never retries), don't text.
    if (await isSmsOptedOut(r.phone)) {
      await db.update(pendingSms).set({ sent_at: now }).where(eq(pendingSms.id, r.id));
      dropped++;
      continue;
    }
    const res = await sendSms({
      to: r.phone,
      body: r.body,
      kind: r.kind,
      companyKey: r.company_key,
      refId: r.ref_id,
    });
    if (res.ok) {
      await db.update(pendingSms).set({ sent_at: now }).where(eq(pendingSms.id, r.id));
      sent++;
    }
    // A transient send failure leaves sent_at null → retried next run.
  }

  return Response.json({ pending: rows.length, sent, heldForWindow: held, droppedOptedOut: dropped });
}
