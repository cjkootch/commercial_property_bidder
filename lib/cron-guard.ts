// Dead-man wrapper for cron routes (quality-plan item #2): a cron that
// throws must PAGE the operator, not vanish into a Vercel log nobody reads.
// Silent failure is indistinguishable from "nothing to do" — which is how
// automation quietly dies.

import { sendEmail } from "./integrations/resend";

export async function guarded(name: string, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    console.error(`cron ${name} FAILED:`, msg);
    const to = process.env.ALERT_EMAIL;
    if (to) {
      await sendEmail({
        to,
        subject: `🔴 cron failed: ${name}`,
        html: `<p><strong>${name}</strong> threw:</p><pre style="font-size:12px;white-space:pre-wrap">${msg
          .slice(0, 2000)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")}</pre>`,
        tags: { kind: "operator_alert" },
      }).catch(() => {});
    }
    return Response.json({ error: `cron ${name} failed`, detail: msg.slice(0, 300) }, { status: 500 });
  }
}
