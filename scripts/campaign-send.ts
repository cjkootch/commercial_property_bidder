import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "../lib/db/schema";
import { sendEmail } from "../lib/integrations/resend";
import { signBuyerUnsub } from "../lib/buyer-auth";

// Send a generated campaign (campaign/<date>/) through the Resend API.
// SAFETY: dry-run by default — prints exactly what would go out; pass --yes to
// send (running with --yes IS the operator approval, spec §9). Suppressed
// emails are skipped. Every send carries one-click unsubscribe headers.
//
//   npm run campaign:send                       (dry run, latest campaign dir)
//   npm run campaign:send -- --yes              (send to each buyer's published_email)
//   npm run campaign:send -- --to you@x.com --yes   (TEST: send every message to one inbox)

const args = process.argv.slice(2);
const YES = args.includes("--yes");
const toIdx = args.indexOf("--to");
const TEST_TO = toIdx !== -1 ? args[toIdx + 1] : null;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
const db = drizzle(neon(url), { schema });

function latestCampaignDir(): string {
  const dirs = readdirSync("campaign", { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  if (!dirs.length) throw new Error("No campaign/<date>/ directories. Run `npm run campaign` first.");
  return `campaign/${dirs[dirs.length - 1]}`;
}

/** kit.csv line parser (quoted fields supported). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function toHtml(msg: string, unsubUrl: string, physicalAddress: string | null): { subject: string; html: string } {
  const lines = msg.split("\n");
  const subject = (lines[0] ?? "").replace(/^SUBJECT:\s*/i, "").trim();
  const body = lines.slice(1).join("\n").trim();
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paras = body
    .split(/\n\n+/)
    .map((p) => {
      const escaped = esc(p).replace(
        /(https?:\/\/[^\s]+)/g,
        (u) => `<a href="${u}" style="color:#2f7d4f;font-weight:600;">${u}</a>`
      );
      return `<p style="margin:0 0 14px;">${escaped.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;line-height:1.55;">` +
    paras +
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">` +
    `<p style="color:#9ca3af;font-size:11px;margin:0;">` +
    (physicalAddress ? `${esc(physicalAddress)} · ` : "") +
    `<a href="${unsubUrl}" style="color:#9ca3af;">Unsubscribe</a></p></div>`;
  return { subject, html };
}

async function main() {
  const dir = latestCampaignDir();
  const kitPath = `${dir}/kit.csv`;
  if (!existsSync(kitPath)) throw new Error(`${kitPath} not found.`);
  const [co] = await db.select().from(schema.company).limit(1);
  const physicalAddress = co?.physical_mailing_address ?? null;

  const suppressed = new Set(
    (await db.select({ email: schema.suppression.email }).from(schema.suppression)).map((r) => r.email)
  );

  const rows = readFileSync(kitPath, "utf8").trim().split("\n");
  const header = parseCsvLine(rows[0]);
  const col = (name: string) => header.indexOf(name);
  const iCompany = col("company");
  const iEmail = col("published_email");
  const iMsg = col("message_file");
  const iStatus = col("status");

  const base = (() => {
    const b = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    return b && !/localhost|127\.0\.0\.1/.test(b) ? b : "https://greenkeep.us";
  })();

  let planned = 0;
  let sent = 0;
  const updated = [rows[0]];
  for (const line of rows.slice(1)) {
    const f = parseCsvLine(line);
    const company = f[iCompany];
    const to = TEST_TO ?? f[iEmail];
    const already = /^sent/.test(f[iStatus] ?? "");
    if (!to) {
      console.log(`  ·  ${company} — no email (use their contact form, or --to)`);
      updated.push(line);
      continue;
    }
    if (suppressed.has(to.toLowerCase())) {
      console.log(`  ·  ${company} — ${to} is suppressed, skipped`);
      updated.push(line);
      continue;
    }
    if (already && !TEST_TO) {
      console.log(`  ·  ${company} — already sent`);
      updated.push(line);
      continue;
    }
    const msg = readFileSync(`${dir}/${f[iMsg]}`, "utf8");
    const unsubUrl = `${base}/api/unsubscribe?token=${encodeURIComponent(signBuyerUnsub(to))}`;
    const { subject, html } = toHtml(msg, unsubUrl, physicalAddress);
    planned++;

    if (!YES) {
      console.log(`  DRY  ${company} -> ${to}  |  ${subject}`);
      updated.push(line);
      continue;
    }
    const res = await sendEmail({
      to,
      subject,
      html,
      tags: { kind: "campaign" },
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (res.ok) {
      sent++;
      console.log(`  ✓  ${company} -> ${to}`);
      f[iStatus] = `sent ${new Date().toISOString().slice(0, 10)}`;
      updated.push(f.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(","));
    } else {
      console.log(`  ✗  ${company} -> ${to}  (${res.error})`);
      updated.push(line);
    }
  }

  if (YES) {
    writeFileSync(kitPath, updated.join("\n") + "\n");
    console.log(`\nSent ${sent}/${planned}. kit.csv statuses updated.`);
  } else {
    console.log(`\nDRY RUN — ${planned} message(s) would send. Re-run with --yes to send.`);
    if (!process.env.RESEND_API_KEY) {
      console.log("(!) RESEND_API_KEY is not set here — sends would fail. Add it to .env first.");
    }
    if (!process.env.BUYER_AUTH_SECRET) {
      console.log("(!) BUYER_AUTH_SECRET is not set here — claim links inside the messages were signed with a fallback secret and will NOT work in production.");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
