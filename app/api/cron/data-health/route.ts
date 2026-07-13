import { NextRequest } from "next/server";
import { runDataHealth, formatHealthReport } from "@/lib/pipeline/data-health";
import { sendEmail } from "@/lib/integrations/resend";

// Weekly data-health profiler (Vercel cron; see vercel.json). Profiles the
// actual VALUES of the high-risk sourced fields (phone/email validity, geocode
// sanity) and emails ALERT_EMAIL if any field's garbage rate crosses its
// threshold — the automated version of the launch-day fire drill so a bad
// scrape batch is caught by an alert, not a live incident. Read-only.
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const report = await runDataHealth();
  const summary = formatHealthReport(report);

  if (report.breaches.length > 0) {
    const to = process.env.ALERT_EMAIL;
    if (to) {
      await sendEmail({
        to,
        subject: `⚠️ Data health: ${report.breaches.length} field(s) crossed the garbage threshold`,
        html: `<p>A sourced field's validity rate regressed past threshold — a feed may be emitting junk. Check the sourcing pipelines.</p><pre style="white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;font-size:13px;">${summary}</pre>`,
        tags: { kind: "data_health_alert" },
      }).catch(() => null);
    } else {
      console.error("data-health breach but ALERT_EMAIL not set:\n" + summary);
    }
  }

  return Response.json({ breaches: report.breaches.length, metrics: report.metrics });
}
