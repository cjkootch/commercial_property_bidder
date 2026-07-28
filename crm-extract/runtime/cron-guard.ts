// Dead-man wrapper for cron routes: a cron that throws must PAGE someone, not
// vanish into a hosting log nobody reads. Silent failure is indistinguishable
// from "nothing to do" — which is how scheduled automation quietly dies.
//
// Ported from lib/cron-guard.ts. Also here: `requireCronSecret`, which every
// cron route in the source app open-coded (and which is the only thing standing
// between a public URL and your database, since cron paths bypass the auth
// middleware by design).

import { sendEmail } from "../email/resend";

/** Bearer-token gate for cron routes. Vercel Cron sends the configured
 *  CRON_SECRET as `Authorization: Bearer <secret>`. Returns a 401 Response when
 *  it doesn't match, or null to proceed. Fails CLOSED on a missing secret. */
export function requireCronSecret(req: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not configured", { status: 401 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

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
        html:
          `<p><strong>${name}</strong> threw:</p>` +
          `<pre style="font-size:12px;white-space:pre-wrap">${msg
            .slice(0, 2000)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")}</pre>`,
        tags: { kind: "ops_alert" },
      }).catch(() => {});
    }
    return Response.json(
      { error: `cron ${name} failed`, detail: msg.slice(0, 300) },
      { status: 500 }
    );
  }
}
