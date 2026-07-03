import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { contact, measurement, pricingResult, property, proposal } from "@/lib/db/schema";
import { grassPercentLabel } from "@/lib/sourcing/criteria";
import { usd } from "@/lib/format";
import { approveAllQueued, approveAndSend, skipQueued } from "./actions";

// Morning approval queue: everything the nightly pipeline made send-ready.
// Approving here IS the explicit operator send approval (build spec §9) —
// nothing is ever emailed without it.
export const dynamic = "force-dynamic";

type Ctx = {
  monthly: number | null;
  needsReview: boolean;
  turf: number | null;
  confidence: string | null;
  slug: string | null;
  email: string | null;
  contactName: string | null;
  contactVia: string | null;
};

async function contextFor(ids: string[]): Promise<Map<string, Ctx>> {
  const ctx = new Map<string, Ctx>();
  if (!ids.length) return ctx;
  for (const id of ids) {
    ctx.set(id, {
      monthly: null, needsReview: false, turf: null, confidence: null,
      slug: null, email: null, contactName: null, contactVia: null,
    });
  }
  const [prs, props, cts, meas] = await Promise.all([
    db.select().from(pricingResult).where(inArray(pricingResult.property_id, ids)).orderBy(desc(pricingResult.created_at)),
    db.select().from(proposal).where(inArray(proposal.property_id, ids)).orderBy(desc(proposal.created_at)),
    db.select().from(contact).where(inArray(contact.property_id, ids)).orderBy(desc(contact.created_at)),
    db.select().from(measurement).where(inArray(measurement.property_id, ids)).orderBy(desc(measurement.created_at)),
  ]);
  // Rows are newest-first; only fill each property's slot once (latest wins).
  for (const r of prs) {
    const c = ctx.get(r.property_id);
    if (c && c.monthly == null) {
      c.monthly = r.monthly_price;
      c.needsReview = !!r.needs_review;
    }
  }
  for (const r of props) {
    const c = ctx.get(r.property_id);
    if (c && c.slug == null) c.slug = r.slug;
  }
  for (const r of cts) {
    const c = ctx.get(r.property_id);
    if (c && c.email == null && r.email?.trim()) {
      c.email = r.email.trim();
      c.contactName = r.full_name;
      c.contactVia = r.title;
    }
  }
  for (const r of meas) {
    const c = ctx.get(r.property_id);
    if (c && c.turf == null) {
      c.turf = r.turf_sqft;
      c.confidence = r.confidence;
    }
  }
  return ctx;
}

export default async function QueuePage() {
  const queued = await db
    .select()
    .from(property)
    .where(eq(property.status, "outreach_drafted"))
    .orderBy(desc(property.updated_at));
  const blocked = await db
    .select()
    .from(property)
    .where(eq(property.status, "proposal_ready"))
    .orderBy(desc(property.updated_at));

  const ctx = await contextFor([...queued, ...blocked].map((p) => p.id));
  const blockedNoEmail = blocked.filter((p) => !ctx.get(p.id)?.email);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Approval queue</h1>
          <p className="mt-1 text-sm text-gray-500">
            Prepared overnight by the pipeline. Nothing sends without your approval here.
          </p>
        </div>
        {queued.length > 1 ? (
          <form action={approveAllQueued}>
            <button className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
              Approve &amp; send all ({queued.length})
            </button>
          </form>
        ) : null}
      </div>

      {queued.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          Queue is empty. The nightly run fills it, or run <code>npm run pipeline</code>.
        </p>
      ) : (
        <div className="mt-6 space-y-3">
          {queued.map((p) => {
            const c = ctx.get(p.id)!;
            return (
              <div key={p.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Link href={`/properties/${p.id}`} className="font-medium text-gray-900 hover:underline">
                        {p.name}
                      </Link>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{p.icp_type}</span>
                      {c.needsReview ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          needs review
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      {c.turf != null ? `${c.turf.toLocaleString()} sf turf` : "no measurement"}
                      {c.confidence ? ` · confidence ${c.confidence}` : ""}
                      {" · grass "}{grassPercentLabel(p.grass_fraction != null ? Number(p.grass_fraction) : null)}
                      {c.monthly != null ? ` · ${usd(c.monthly, { cents: false })}/mo` : ""}
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      To: <span className="text-gray-800">{c.contactName ?? "—"}</span>
                      {c.email ? <> &lt;{c.email}&gt;</> : null}
                      {c.contactVia ? <span className="text-gray-400"> · {c.contactVia}</span> : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.slug ? (
                      <a
                        href={`/proposals/${c.slug}`}
                        target="_blank"
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        Preview proposal
                      </a>
                    ) : null}
                    <form action={skipQueued.bind(null, p.id)}>
                      <button className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                        Skip
                      </button>
                    </form>
                    <form action={approveAndSend.bind(null, p.id)}>
                      <button className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">
                        Approve &amp; send
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {blockedNoEmail.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-lg font-medium">Ready but missing a contact ({blockedNoEmail.length})</h2>
          <p className="mt-1 text-sm text-gray-500">
            Proposal is ready; the free contact finder found no email. Open the property to enrich
            (Apollo) or add a contact manually.
          </p>
          <ul className="mt-3 space-y-2">
            {blockedNoEmail.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm">
                <span>{p.name}</span>
                <Link href={`/properties/${p.id}`} className="font-medium text-brand hover:underline">
                  Open →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
