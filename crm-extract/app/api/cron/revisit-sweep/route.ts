// Daily revisit sweep. THE most important scheduled job in the system.
//
// Schedule (vercel.json):
//   { "path": "/api/cron/revisit-sweep", "schedule": "0 12 * * 1-5" }
// 12:00 UTC = 7am CT / 8am ET — the digest is in the inbox before the working
// day, on weekdays only (a Saturday reminder gets ignored, and being ignored is
// how a reminder system dies).
//
// Wrapped in guarded() so a throw pages ops instead of vanishing; stamps a
// heartbeat so a job that stops running entirely is detectable; and cross-checks
// its own output so a job that runs but silently surfaces nothing is detectable
// too. Both checks exist because the source app's outreach volume decayed to zero
// across a week of green cron runs with nobody notified.

import { NextResponse, type NextRequest } from "next/server";
import { guarded, requireCronSecret } from "../../../../runtime/cron-guard";
import { checkSweepOutput, recordHeartbeat } from "../../../../runtime/tripwire";
import { pruneUsageCounters } from "../../../../runtime/ratelimit";
import {
  listDueRevisits,
  revisitDigestText,
  runRevisitSweep,
  todayInTz,
  type DueRevisit,
} from "../../../../crm/revisit";
import { sendEmail } from "../../../../email/resend";
import { digestEmail } from "../../../../email/transactional";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const TZ = process.env.CRM_TIMEZONE || "America/New_York";
const JOB = "revisit-sweep";

export async function GET(req: NextRequest) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  return guarded(JOB, async () => {
    const today = todayInTz(TZ);
    const baseUrl = process.env.APP_BASE_URL ?? "";
    // ?dry=1 to inspect what WOULD fire without writing or sending.
    const apply = req.nextUrl.searchParams.get("dry") !== "1";

    const sendDigest = async (to: string, items: DueRevisit[]) => {
      const text = revisitDigestText(items, baseUrl);
      const res = await sendEmail({
        to,
        subject: `${items.length} revisit${items.length === 1 ? "" : "s"} due today`,
        html: digestEmail({ heading: "Revisits due", bodyText: text }),
        text,
        tags: { kind: "revisit_digest" },
      });
      // sendEmail never throws; surface a provider failure so the sweep's log
      // (and the caller's catch) can record it.
      if (!res.ok) throw new Error(res.error);
    };

    const summary = await runRevisitSweep({ today, apply, sendDigest });

    // Outstanding = everything due, surfaced or not. If we surfaced nothing while
    // work is outstanding, something is wrong with the sweep, not the calendar.
    const outstanding = (await listDueRevisits({ today, limit: 1000 })).length;
    await checkSweepOutput({ job: JOB, surfaced: summary.surfaced, outstanding });

    if (apply) {
      await recordHeartbeat(JOB);
      await pruneUsageCounters();
    }

    return NextResponse.json({
      job: JOB,
      today,
      timezone: TZ,
      apply,
      outstanding,
      ...summary,
    });
  });
}
