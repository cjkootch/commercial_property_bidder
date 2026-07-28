// Company record page: identity, the revisit control, contacts, deals, custom
// fields, and ONE unified timeline.
//
// Ported in spirit from app/companies/[id]/page.tsx (471 lines), which rendered
// email history and the SMS thread as two separate lists because they lived in
// two tables. Here `companyTimeline()` is a single indexed query over `activity`,
// so calls, emails in and out, letters, notes, stage changes and revisit events
// interleave correctly by when they happened.
//
// The revisit control is at the TOP, above contacts and deals, because it is the
// field the firm's whole process turns on.
//
// Place at app/companies/[id]/page.tsx.

import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, isNull } from "drizzle-orm";
import { db } from "../../../db";
import { brand, company, contact, crmUser, deal, pipelineStage } from "../../../db/schema";
import { companyTimeline } from "../../../crm/activity";
import { fieldsForRecord } from "../../../crm/custom-fields";
import { recordHistory } from "../../../crm/audit";
import { todayInTz } from "../../../crm/revisit";
import { setRevisitAction } from "../../revisits/actions";
import { logCallAction, logNoteAction, setCustomFieldAction } from "../actions";

export const dynamic = "force-dynamic";

const TZ = process.env.CRM_TIMEZONE || "America/New_York";

const KIND_LABEL: Record<string, string> = {
  call: "Call",
  email_out: "Email sent",
  email_in: "Reply received",
  letter: "Letter",
  meeting: "Meeting",
  note: "Note",
  stage_change: "Stage change",
  revisit_due: "Revisit due",
  system: "System",
};

const KIND_STYLE: Record<string, string> = {
  call: "bg-blue-100 text-blue-800",
  email_out: "bg-gray-100 text-gray-700",
  email_in: "bg-green-100 text-green-800",
  letter: "bg-purple-100 text-purple-800",
  meeting: "bg-indigo-100 text-indigo-800",
  note: "bg-yellow-100 text-yellow-800",
  stage_change: "bg-teal-100 text-teal-800",
  revisit_due: "bg-amber-100 text-amber-800",
  system: "bg-gray-100 text-gray-500",
};

const fmt = (d: Date | null) =>
  d
    ? d.toLocaleString("en-US", {
        timeZone: TZ,
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

export default async function CompanyPage({ params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();

  const [row] = await db
    .select({ c: company, brandName: brand.name, ownerName: crmUser.name })
    .from(company)
    .leftJoin(brand, eq(company.brand_id, brand.id))
    .leftJoin(crmUser, eq(company.owner_user_id, crmUser.id))
    .where(eq(company.id, params.id))
    .limit(1);
  if (!row) notFound();
  const c = row.c;
  const today = todayInTz(TZ);
  const due = !!c.revisit_date && c.revisit_date <= today;

  const [contacts, deals, timeline, customFields, users, history] = await Promise.all([
    db
      .select()
      .from(contact)
      .where(eq(contact.company_id, c.id))
      .orderBy(desc(contact.is_primary), contact.priority_rank, contact.full_name),
    db
      .select({ d: deal, stageLabel: pipelineStage.label, stageKind: pipelineStage.kind })
      .from(deal)
      .leftJoin(pipelineStage, eq(deal.stage_id, pipelineStage.id))
      .where(eq(deal.company_id, c.id))
      .orderBy(desc(deal.updated_at)),
    companyTimeline(c.id, { limit: 200 }),
    fieldsForRecord("company", c.id),
    db.select({ id: crmUser.id, name: crmUser.name }).from(crmUser).where(isNull(crmUser.disabled_at)),
    recordHistory("company", c.id, 20),
  ]);

  return (
    <div className="pb-16">
      <Link href="/companies" className="text-sm text-gray-400 hover:text-gray-600">
        ← Companies
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{c.name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {[c.city, c.state].filter(Boolean).join(", ") || "—"}
            {c.domain ? (
              <>
                {" · "}
                <a
                  href={c.website ?? `https://${c.domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  {c.domain}
                </a>
              </>
            ) : null}
            {c.phone ? ` · ${c.phone}` : ""}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {row.brandName ? `Brand: ${row.brandName}` : "No brand"} ·{" "}
            {row.ownerName ? `Owner: ${row.ownerName}` : "Unowned"}
            {c.source ? ` · Source: ${c.source}` : ""}
          </p>
        </div>
        {c.blocked_at ? (
          <span className="rounded-full bg-gray-200 px-3 py-1 text-xs font-bold text-gray-700">
            BLOCKED{c.blocked_reason ? ` · ${c.blocked_reason}` : ""}
          </span>
        ) : null}
      </div>

      {/* --- REVISIT: the control this system exists for -------------------- */}
      <section
        className={`mt-5 rounded-xl border p-4 ${
          due ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white"
        }`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Revisit</h2>
          {c.revisit_date ? (
            <span className={`text-xs font-semibold ${due ? "text-amber-800" : "text-gray-500"}`}>
              {due ? "DUE" : "scheduled"} {c.revisit_date}
            </span>
          ) : (
            <span className="text-xs text-gray-400">not scheduled</span>
          )}
        </div>
        {c.revisit_note ? (
          <p className="mt-2 text-sm italic text-gray-700">&ldquo;{c.revisit_note}&rdquo;</p>
        ) : null}
        <form action={setRevisitAction} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="entity" value="company" />
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="companyId" value={c.id} />
          <label className="text-xs text-gray-500">
            Date
            <input
              type="date"
              name="date"
              defaultValue={c.revisit_date ?? ""}
              className="mt-0.5 block rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="flex-1 text-xs text-gray-500">
            Why (shown in the queue)
            <input
              name="note"
              defaultValue={c.revisit_note ?? ""}
              placeholder="Said call back after the 2027 harvest…"
              className="mt-0.5 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-gray-500">
            Owner
            <select
              name="userId"
              defaultValue={c.revisit_user_id ?? c.owner_user_id ?? ""}
              className="mt-0.5 block rounded-md border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="">— me —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <button className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-700">
            Save
          </button>
          <span className="text-xs text-gray-400">Clear the date to remove the fuse.</span>
        </form>
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* --- left column: contacts, deals, custom fields ----------------- */}
        <div className="space-y-5">
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Contacts</h2>
            <ul className="mt-2 space-y-2">
              {contacts.map((p) => (
                <li key={p.id} className="text-sm">
                  <div className="font-medium text-gray-900">
                    {p.full_name}
                    {p.is_primary ? (
                      <span className="ml-1.5 rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        PRIMARY
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-gray-500">
                    {[p.title, p.email, p.mobile ?? p.phone].filter(Boolean).join(" · ") || "—"}
                  </div>
                  {p.revisit_date ? (
                    <div className="text-xs text-amber-700">revisit {p.revisit_date}</div>
                  ) : null}
                </li>
              ))}
              {contacts.length === 0 ? <li className="text-sm text-gray-400">No contacts yet.</li> : null}
            </ul>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Deals</h2>
            <ul className="mt-2 space-y-2">
              {deals.map(({ d, stageLabel, stageKind }) => (
                <li key={d.id} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-900">{d.title}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        stageKind === "nurture"
                          ? "bg-amber-100 text-amber-800"
                          : stageKind === "won"
                            ? "bg-green-100 text-green-800"
                            : stageKind === "lost"
                              ? "bg-gray-100 text-gray-500"
                              : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      {stageLabel ?? "—"}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {d.value_cents != null
                      ? `$${(d.value_cents / 100).toLocaleString()} ${d.currency}`
                      : "no value set"}
                    {d.revisit_date ? ` · revisit ${d.revisit_date}` : ""}
                  </div>
                </li>
              ))}
              {deals.length === 0 ? <li className="text-sm text-gray-400">No deals yet.</li> : null}
            </ul>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Custom fields</h2>
            <div className="mt-2 space-y-2">
              {customFields.map(({ def, value }) => (
                <form key={def.id} action={setCustomFieldAction} className="flex items-end gap-2">
                  <input type="hidden" name="defId" value={def.id} />
                  <input type="hidden" name="recordId" value={c.id} />
                  <input type="hidden" name="companyId" value={c.id} />
                  <label className="flex-1 text-xs text-gray-500">
                    {def.label}
                    {def.type === "enum" ? (
                      <select
                        name="value"
                        defaultValue={value === null ? "" : String(value)}
                        className="mt-0.5 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                      >
                        <option value="">—</option>
                        {(def.options ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : def.type === "boolean" ? (
                      <select
                        name="value"
                        defaultValue={value === null ? "" : value ? "true" : "false"}
                        className="mt-0.5 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                      >
                        <option value="">—</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    ) : (
                      <input
                        name="value"
                        type={def.type === "date" ? "date" : def.type === "number" ? "number" : "text"}
                        defaultValue={value === null ? "" : String(value)}
                        className="mt-0.5 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                      />
                    )}
                  </label>
                  <button className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">
                    Set
                  </button>
                </form>
              ))}
              {customFields.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No custom fields defined yet.
                </p>
              ) : null}
            </div>
          </section>
        </div>

        {/* --- right column: log + timeline -------------------------------- */}
        <div className="space-y-5 lg:col-span-2">
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Log activity</h2>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <form action={logCallAction} className="space-y-2">
                <input type="hidden" name="companyId" value={c.id} />
                <textarea
                  name="body"
                  required
                  rows={3}
                  placeholder="Call notes…"
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
                <div className="flex items-center gap-2">
                  <select
                    name="contactId"
                    className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs"
                    defaultValue=""
                  >
                    <option value="">(no contact)</option>
                    {contacts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                  </select>
                  <button className="rounded-md bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800">
                    Log call
                  </button>
                </div>
              </form>
              <form action={logNoteAction} className="space-y-2">
                <input type="hidden" name="companyId" value={c.id} />
                <textarea
                  name="body"
                  required
                  rows={3}
                  placeholder="Note…"
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
                <button className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700">
                  Add note
                </button>
              </form>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white">
            <h2 className="border-b border-gray-100 px-4 py-3 text-sm font-bold uppercase tracking-wide text-gray-500">
              Timeline
            </h2>
            <ol className="divide-y divide-gray-50">
              {timeline.map((t) => (
                <li key={t.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        KIND_STYLE[t.kind] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {KIND_LABEL[t.kind] ?? t.kind}
                    </span>
                    <span className="text-xs text-gray-400">{fmt(t.occurred_at)}</span>
                    {t.contactName ? (
                      <span className="text-xs text-gray-500">· {t.contactName}</span>
                    ) : null}
                    {t.actorName ? <span className="text-xs text-gray-400">· {t.actorName}</span> : null}
                    {/* Delivery state rides the same row as the message. */}
                    {t.kind === "email_out" ? (
                      <span className="text-[10px] text-gray-400">
                        {t.bounced_at
                          ? "· bounced"
                          : t.clicked_at
                            ? `· clicked${t.click_count > 1 ? ` ×${t.click_count}` : ""}`
                            : t.opened_at
                              ? `· opened${t.open_count > 1 ? ` ×${t.open_count}` : ""}`
                              : t.delivered_at
                                ? "· delivered"
                                : "· sent"}
                      </span>
                    ) : null}
                  </div>
                  {t.subject ? (
                    <p className="mt-1 text-sm font-medium text-gray-900">{t.subject}</p>
                  ) : null}
                  {t.body ? (
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-600">
                      {t.body.length > 1200 ? `${t.body.slice(0, 1200)}…` : t.body}
                    </p>
                  ) : null}
                </li>
              ))}
              {timeline.length === 0 ? (
                <li className="px-4 py-10 text-center text-sm text-gray-400">
                  Nothing logged yet.
                </li>
              ) : null}
            </ol>
          </section>

          {history.length ? (
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Changes</h2>
              <ul className="mt-2 space-y-1 text-xs text-gray-500">
                {history.map((h) => (
                  <li key={h.id}>
                    {fmt(h.created_at)} · {h.action}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
