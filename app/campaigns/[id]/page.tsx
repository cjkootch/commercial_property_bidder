import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { leadUnlock, outreachCampaign, outreachRecipient, property } from "@/lib/db/schema";
import { leadMaxBuyers } from "@/lib/leads/availability";
import {
  approveMessaging,
  approveProperties,
  approveRecipients,
  backToStage,
  cancelCampaign,
  executeCampaign,
  toggleRecipient,
  updateMessage,
} from "../actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // recipient discovery scrapes several sites

const STAGES = ["properties", "recipients", "messaging", "ready"] as const;
const STAGE_TITLE: Record<string, string> = {
  properties: "1 · Properties & parameters",
  recipients: "2 · Companies",
  messaging: "3 · Messaging",
  ready: "4 · Send",
};
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;
const usdN = (n: number) => `$${Math.round(n).toLocaleString()}`;
const note = (notes: string | null, re: RegExp) => notes?.match(re)?.[1]?.trim() ?? null;

export default async function CampaignDetail({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { err?: string };
}) {
  const [c] = await db.select().from(outreachCampaign).where(eq(outreachCampaign.id, params.id)).limit(1);
  if (!c) notFound();

  const recipients = await db
    .select()
    .from(outreachRecipient)
    .where(eq(outreachRecipient.campaign_id, c.id))
    .orderBy(asc(outreachRecipient.distance_mi));
  const cap = leadMaxBuyers();
  const done = c.stage === "sent" || c.stage === "canceled";
  const activeIdx = STAGES.indexOf(c.stage as (typeof STAGES)[number]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/campaigns" className="text-sm text-gray-500 hover:text-gray-800">
            ← All campaigns
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{c.label}</h1>
        </div>
        {!done ? (
          <form action={cancelCampaign.bind(null, c.id)}>
            <button className="text-sm text-gray-400 hover:text-red-600">Cancel campaign</button>
          </form>
        ) : null}
      </div>

      {/* Stepper */}
      <div className="flex flex-wrap gap-2">
        {STAGES.map((s, i) => {
          const state = c.stage === "sent" ? "done" : i < activeIdx ? "done" : i === activeIdx ? "active" : "todo";
          return (
            <div
              key={s}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                state === "active"
                  ? "bg-brand text-white"
                  : state === "done"
                    ? "bg-brand/10 text-brand"
                    : "bg-gray-100 text-gray-400"
              }`}
            >
              {STAGE_TITLE[s]}
            </div>
          );
        })}
      </div>

      {searchParams.err ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{searchParams.err}</p>
      ) : null}

      {c.stage === "canceled" ? (
        <p className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">This campaign was canceled.</p>
      ) : null}

      {c.stage === "properties" ? <PropertiesStage campaignId={c.id} price={c.price_cents} excl={c.exclusive_price_cents} /> : null}
      {c.stage === "recipients" ? <RecipientsStage campaignId={c.id} recipients={recipients} cap={cap} /> : null}
      {c.stage === "messaging" ? <MessagingStage campaignId={c.id} recipients={recipients.filter((r) => r.included)} /> : null}
      {(c.stage === "ready" || c.stage === "sent") ? (
        <SendStage campaign={c} recipients={recipients.filter((r) => r.included || c.stage === "sent")} />
      ) : null}
    </div>
  );
}

/* ---------- Gate 1: properties & parameters ---------- */
async function PropertiesStage({ campaignId, price, excl }: { campaignId: string; price: number; excl: number }) {
  const cap = leadMaxBuyers();
  const open = await db.select().from(property).where(like(property.name, "%(TABS %")).orderBy(desc(property.created_at));
  const unlocks = await db.select({ pid: leadUnlock.property_id, kind: leadUnlock.kind }).from(leadUnlock);
  const count = new Map<string, number>();
  const excl2 = new Set<string>();
  for (const u of unlocks) {
    count.set(u.pid, (count.get(u.pid) ?? 0) + 1);
    if (u.kind === "exclusive") excl2.add(u.pid);
  }
  const sellable = open.filter(
    (p) => p.lead_exported_at == null && p.parcel_geojson != null && !excl2.has(p.id) && (count.get(p.id) ?? 0) < cap
  );

  return (
    <form action={approveProperties.bind(null, campaignId)} className="space-y-5">
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Choose the opportunities to feature ({sellable.length} open)
        </h2>
        {sellable.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            No sellable leads right now. Run <code className="rounded bg-gray-100 px-1">source:permits</code> or wait for
            the weekly cron.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {sellable.map((p) => {
              const teaser = p.lead_teaser as { annual_lo?: number; annual_hi?: number } | null;
              const spots = cap - (count.get(p.id) ?? 0);
              return (
                <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-100 p-3 hover:bg-gray-50">
                  <input type="checkbox" name="property_id" value={p.id} defaultChecked className="h-4 w-4" />
                  <span className="flex-1">
                    <span className="font-medium text-gray-900">
                      {p.name.replace(/ \(TABS [^)]+\)$/, "")}
                    </span>
                    <span className="ml-2 text-sm text-gray-500">
                      {p.city ?? ""}
                      {teaser?.annual_lo ? ` · ${usdN(teaser.annual_lo)}–${usdN(teaser.annual_hi ?? teaser.annual_lo)}/yr` : ""}
                      {` · ${spots} of ${cap} spots`}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid grid-cols-3 gap-4 rounded-xl border border-gray-200 bg-white p-5">
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Lead price ($)</span>
          <input name="price_usd" type="number" defaultValue={Math.round(price / 100)} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Exclusive price ($)</span>
          <input name="exclusive_usd" type="number" defaultValue={Math.round(excl / 100)} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Max companies to find</span>
          <input name="max_buyers" type="number" defaultValue={20} min={1} max={50} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
        </label>
      </section>

      <button
        disabled={sellable.length === 0}
        className="rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
      >
        Approve properties → find companies
      </button>
      <p className="text-xs text-gray-400">
        Finding companies discovers landscapers near each lead and drafts their messages — this can
        take up to a minute.
      </p>
    </form>
  );
}

type Recipient = typeof outreachRecipient.$inferSelect;

/* ---------- Gate 2: companies ---------- */
function RecipientsStage({ campaignId, recipients, cap }: { campaignId: string; recipients: Recipient[]; cap: number }) {
  const included = recipients.filter((r) => r.included);
  const withEmail = included.filter((r) => r.email).length;
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Companies ({included.length} in, {recipients.length - included.length} out)
          </h2>
          <span className="text-xs text-gray-400">{withEmail} have an email · rest need their contact form</span>
        </div>
        {recipients.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            No companies found — set <code className="rounded bg-gray-100 px-1">APOLLO_API_KEY</code> to discover
            landscapers, or add buyers manually. You can go back and retry.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-gray-100">
            {recipients.map((r) => (
              <div key={r.id} className={`flex items-center gap-3 py-3 ${r.included ? "" : "opacity-50"}`}>
                <form action={toggleRecipient.bind(null, campaignId, r.id, !r.included)}>
                  <button
                    className={`h-5 w-5 rounded border text-xs ${r.included ? "border-brand bg-brand text-white" : "border-gray-300 text-transparent"}`}
                    title={r.included ? "Remove" : "Add back"}
                  >
                    ✓
                  </button>
                </form>
                <div className="flex-1">
                  <div className="font-medium text-gray-900">{r.company_name}</div>
                  <div className="text-sm text-gray-500">
                    {r.city ?? "location unknown"}
                    {r.distance_mi != null ? ` · ${Math.round(r.distance_mi)} mi from lead` : ""}
                    {r.email ? ` · ${r.email}` : r.contact_form_url ? " · contact form" : " · no channel found"}
                  </div>
                </div>
                <span className="max-w-[16rem] truncate text-xs text-gray-400">{r.subject}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      <div className="flex gap-3">
        <form action={backToStage.bind(null, campaignId, "properties")}>
          <button className="rounded-md border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            ← Back
          </button>
        </form>
        <form action={approveRecipients.bind(null, campaignId)}>
          <button
            disabled={included.length === 0}
            className="rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
          >
            Approve {included.length} compan{included.length === 1 ? "y" : "ies"} → review messaging
          </button>
        </form>
      </div>
    </div>
  );
}

/* ---------- Gate 3: messaging ---------- */
function MessagingStage({ campaignId, recipients }: { campaignId: string; recipients: Recipient[] }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Review each message. Edit any of them — the claim link inside is personal to that company, so
        keep the URL. Reply-to and footer are added on send.
      </p>
      {recipients.map((r) => (
        <details key={r.id} className="rounded-xl border border-gray-200 bg-white p-5">
          <summary className="cursor-pointer text-sm font-medium text-gray-900">
            {r.company_name}
            <span className="ml-2 font-normal text-gray-400">{r.email ?? "contact form"}</span>
          </summary>
          <form action={updateMessage.bind(null, campaignId, r.id)} className="mt-4 space-y-2">
            <input
              name="subject"
              defaultValue={r.subject ?? ""}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-medium"
            />
            <textarea
              name="body"
              defaultValue={r.body ?? ""}
              rows={12}
              className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs leading-relaxed"
            />
            <button className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
              Save edits
            </button>
          </form>
        </details>
      ))}
      <div className="flex gap-3">
        <form action={backToStage.bind(null, campaignId, "recipients")}>
          <button className="rounded-md border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            ← Back
          </button>
        </form>
        <form action={approveMessaging.bind(null, campaignId)}>
          <button className="rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">
            Approve messaging → send
          </button>
        </form>
      </div>
    </div>
  );
}

/* ---------- Gate 4: send / sent ---------- */
function SendStage({ campaign, recipients }: { campaign: typeof outreachCampaign.$inferSelect; recipients: Recipient[] }) {
  const emailable = recipients.filter((r) => r.email);
  const manual = recipients.filter((r) => !r.email);
  const sent = recipients.filter((r) => r.status === "sent").length;
  const isSent = campaign.stage === "sent";

  return (
    <div className="space-y-4">
      {isSent ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-sm text-green-800">
          <div className="font-semibold">Sent {campaign.sent_at?.toISOString().slice(0, 10)}.</div>
          <p className="mt-1">
            {sent} email{sent === 1 ? "" : "s"} delivered. {manual.length} compan
            {manual.length === 1 ? "y needs" : "ies need"} manual outreach via their contact form
            (copy the message below).
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <div className="text-sm font-semibold text-amber-900">Ready to send</div>
          <p className="mt-1 text-sm text-amber-800">
            {emailable.length} email{emailable.length === 1 ? "" : "s"} will go out now. {manual.length}{" "}
            compan{manual.length === 1 ? "y has" : "ies have"} no email — they&apos;ll be flagged for
            manual contact-form outreach.
          </p>
          <form action={executeCampaign.bind(null, campaign.id)} className="mt-4">
            <button className="rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">
              Send {emailable.length} email{emailable.length === 1 ? "" : "s"} now
            </button>
          </form>
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="divide-y divide-gray-100">
          {recipients.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <span className="font-medium text-gray-900">{r.company_name}</span>
                <span className="ml-2 text-sm text-gray-500">{r.email ?? r.contact_form_url ?? "no channel"}</span>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  r.status === "sent"
                    ? "bg-green-100 text-green-800"
                    : r.status === "manual"
                      ? "bg-amber-100 text-amber-800"
                      : r.status === "failed"
                        ? "bg-red-100 text-red-700"
                        : r.status === "skipped"
                          ? "bg-gray-100 text-gray-500"
                          : "bg-gray-100 text-gray-500"
                }`}
              >
                {r.status}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
