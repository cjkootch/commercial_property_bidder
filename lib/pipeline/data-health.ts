// Recurring data-health profiler. The launch-day lesson (2026-07-13): we
// audited the CODE that reads the data for months and never profiled the DATA
// itself — 58% of phone numbers were structurally-invalid scrapes, invisible
// until real numbers hit a real carrier. This job closes that gap: it samples
// the ACTUAL VALUES of the high-risk sourced fields, computes validity rates,
// and flags any field whose garbage rate crosses a threshold — so a sourcing
// feed that starts emitting junk is caught by an alert, not by a live incident.
//
// Read-only. Runs weekly (see vercel.json); alerts ALERT_EMAIL on any breach.

import { isNotNull } from "drizzle-orm";
import { db } from "../db";
import { prospectCompany, property, buyerOutreach, residentialLead } from "../db/schema";
import { toE164 } from "../integrations/twilio";
import { isPlaceholderEmail } from "../buyer-auth";

/** Well-formed, non-placeholder, non-obviously-fake email. */
export function emailLooksReal(e: string | null | undefined): boolean {
  if (!e) return false;
  if (isPlaceholderEmail(e)) return false;
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) return false;
  if (/(example\.|test@|@test\.|noreply|no-reply|@domain\.|@email\.com$|invalid|xxx)/i.test(e)) return false;
  return true;
}

/** A geocode that plausibly sits inside the continental US. */
export function geoLooksValid(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (lat == null || lng == null) return false;
  if (lat === 0 && lng === 0) return false;
  return lat >= 24 && lat <= 50 && lng >= -125 && lng <= -66;
}

export type HealthMetric = {
  name: string;
  total: number;
  bad: number;
  badPct: number; // 0-100, one decimal
  threshold: number; // 0-1 fraction
  breached: boolean;
  sample: string[]; // up to 3 example bad values
};

/** Pure evaluator — testable without a DB. Only breaches on a meaningful
 *  sample size (>= 25) so a handful of rows can't trip a false alarm. */
export function evaluateMetric(
  name: string,
  total: number,
  bad: number,
  threshold: number,
  sample: string[] = []
): HealthMetric {
  const frac = total > 0 ? bad / total : 0;
  return {
    name,
    total,
    bad,
    badPct: Math.round(frac * 1000) / 10,
    threshold,
    breached: total >= 25 && frac > threshold,
    sample: sample.slice(0, 3),
  };
}

// Thresholds sit above the healthy baseline measured 2026-07-13 (phones ~21%
// invalid after known bad scrapes; emails/geo ~0-1%). A breach means the rate
// REGRESSED — a feed started producing junk — not that some junk exists.
const THRESHOLDS = { phone: 0.35, email: 0.06, geo: 0.04 } as const;

export type DataHealthReport = { metrics: HealthMetric[]; breaches: HealthMetric[] };

export async function runDataHealth(): Promise<DataHealthReport> {
  const [pc, props, bo, rl] = await Promise.all([
    db
      .select({ phone: prospectCompany.phone, email: prospectCompany.email })
      .from(prospectCompany)
      .where(isNotNull(prospectCompany.phone)),
    db.select({ lat: property.lat, lng: property.lng }).from(property),
    db.select({ phone: buyerOutreach.phone }).from(buyerOutreach).where(isNotNull(buyerOutreach.phone)),
    db.select({ lat: residentialLead.lat, lng: residentialLead.lng }).from(residentialLead),
  ]);

  const badPhones = pc.filter((r) => !toE164(r.phone));
  // Email metric is only over rows that HAVE an email (null email is expected
  // for phone-only companies, not a quality defect).
  const withEmail = pc.filter((r) => r.email);
  const badEmails = withEmail.filter((r) => !emailLooksReal(r.email));
  const badPropGeo = props.filter((p) => !geoLooksValid(p.lat, p.lng));
  const badBoPhones = bo.filter((r) => !toE164(r.phone));
  const badResGeo = rl.filter((r) => !geoLooksValid(r.lat, r.lng));

  const metrics = [
    evaluateMetric("prospect_company.phone invalid", pc.length, badPhones.length, THRESHOLDS.phone,
      badPhones.map((r) => r.phone!)),
    evaluateMetric("prospect_company.email malformed", withEmail.length, badEmails.length, THRESHOLDS.email,
      badEmails.map((r) => r.email!)),
    evaluateMetric("property geocode invalid", props.length, badPropGeo.length, THRESHOLDS.geo,
      badPropGeo.map((p) => `${p.lat},${p.lng}`)),
    evaluateMetric("buyer_outreach.phone invalid", bo.length, badBoPhones.length, THRESHOLDS.phone,
      badBoPhones.map((r) => r.phone!)),
    evaluateMetric("residential_lead geocode invalid", rl.length, badResGeo.length, THRESHOLDS.geo,
      badResGeo.map((r) => `${r.lat},${r.lng}`)),
  ];

  return { metrics, breaches: metrics.filter((m) => m.breached) };
}

/** Human-readable summary for the alert email / cron response. */
export function formatHealthReport(report: DataHealthReport): string {
  return report.metrics
    .map((m) => `${m.breached ? "⚠️ " : "✓ "}${m.name}: ${m.badPct}% bad (${m.bad}/${m.total}, threshold ${Math.round(m.threshold * 100)}%)${m.breached && m.sample.length ? ` — e.g. ${m.sample.join(", ")}` : ""}`)
    .join("\n");
}
