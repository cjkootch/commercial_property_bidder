import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { buyer, buyerOutreach, leadUnlock, property, prospectCompany, smsOptOut, smsSend } from "@/lib/db/schema";
import { displayName } from "@/lib/leads/market";
import { TRADES, asTrade } from "@/lib/leads/trades";
import { toE164 } from "@/lib/integrations/twilio";
import { blockCompany, replyToCompany, smsCompany, unblockCompany } from "../actions";

// Company profile drill-down: identity, the full cross-campaign email journey
// (every send with its funnel state and the exact copy), claim-page reads, and
// — once they convert — the linked account with its unlocks.
export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d
    ? d.toLocaleString("en-US", {
        timeZone: "America/Chicago", month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

export default async function CompanyProfilePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { reply?: string; sms?: string };
}) {
  const [p] = await db
    .select()
    .from(prospectCompany)
    .where(eq(prospectCompany.id, params.id))
    .limit(1);

  if (!p) {
    return (
      <div>
        <Link href="/companies" className="text-sm text-gray-400 hover:text-gray-600">
          ← Companies
        </Link>
        <p className="mt-4 text-sm text-gray-500">Company not found.</p>
      </div>
    );
  }

  // Every campaign email this company ever received, with the lead it pitched.
  const outreach = await db
    .select({
      o: buyerOutreach,
      prop_address: property.address,
      prop_city: property.city,
      prop_name: property.name,
    })
    .from(buyerOutreach)
    .leftJoin(property, eq(buyerOutreach.property_id, property.id))
    .where(eq(buyerOutreach.company_key, p.key))
    .orderBy(desc(buyerOutreach.sent_at), desc(buyerOutreach.created_at));

  // Stats count CAMPAIGN sends only — operator direct replies (no claim
  // link) still show in the history below but don't inflate the funnel.
  const campaignRows = outreach.filter((r) => r.o.claim_url);
  const sends = campaignRows.filter((r) => r.o.status === "sent" || r.o.status === "bounced");
  const opens = sends.filter((r) => r.o.opened_at).length;
  const clicks = sends.filter((r) => r.o.clicked_at).length;
  const bounced = sends.some((r) => r.o.status === "bounced");
  const score = p.buyer_id ? -1 : p.claim_views * 5 + clicks * 3 + opens;

  // Converted? Pull the account + what it has unlocked.
  const account = p.buyer_id
    ? (await db.select().from(buyer).where(eq(buyer.id, p.buyer_id)).limit(1))[0] ?? null
    : null;
  const unlocks = account
    ? await db
        .select({
          kind: leadUnlock.kind,
          trade: leadUnlock.trade,
          price_cents: leadUnlock.price_cents,
          at: leadUnlock.created_at,
          prop_id: property.id,
          prop_address: property.address,
          prop_city: property.city,
          prop_name: property.name,
        })
        .from(leadUnlock)
        .leftJoin(property, eq(leadUnlock.property_id, property.id))
        .where(eq(leadUnlock.buyer_id, account.id))
        .orderBy(desc(leadUnlock.created_at))
    : [];

  // SMS thread + opt-out state. Guarded: before migration 0045 these tables
  // don't exist yet, and the rest of the profile must still render.
  let smsThread: (typeof smsSend.$inferSelect)[] = [];
  let smsOptedOut = false;
  const phoneE164 = toE164(p.phone);
  try {
    smsThread = await db
      .select()
      .from(smsSend)
      .where(eq(smsSend.company_key, p.key))
      .orderBy(desc(smsSend.created_at));
    if (phoneE164) {
      const [opt] = await db
        .select({ id: smsOptOut.id })
        .from(smsOptOut)
        .where(eq(smsOptOut.phone, phoneE164))
        .limit(1);
      smsOptedOut = !!opt;
    }
  } catch {
    // sms tables not migrated yet — the compose form still works once they are.
  }

  const usd = (c: number) => `$${(c / 100).toLocaleString()}`;
  // null = not a campaign row (operator direct reply) — badge it as a reply,
  // never as a phantom "Landscaping" campaign.
  const rowTrade = (claimUrl: string | null) => {
    const m = claimUrl?.match(/[?&]trade=([a-z]+)/)?.[1];
    return m ? asTrade(m) : null;
  };

  return (
    <div>
      <Link href="/companies" className="text-sm text-gray-400 hover:text-gray-600">
        ← Companies
      </Link>
      <h1 className="mt-2 flex flex-wrap items-center gap-2 text-2xl font-semibold">
        {p.name}
        <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-bold text-brand">
          {TRADES[asTrade(p.trade)].label}
        </span>
        {p.blocked_at ? (
          <span className="rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
            BLOCKED
          </span>
        ) : account ? (
          <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
            ACCOUNT
          </span>
        ) : bounced ? (
          <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
            BOUNCED
          </span>
        ) : score >= 5 ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
            📞 CALL
          </span>
        ) : null}
        {account ? null : p.blocked_at ? (
          <form action={unblockCompany}>
            <input type="hidden" name="id" value={p.id} />
            <button className="text-xs font-normal text-gray-400 hover:text-gray-600 hover:underline">
              unblock
            </button>
          </form>
        ) : (
          <form action={blockCompany}>
            <input type="hidden" name="id" value={p.id} />
            <button
              className="text-xs font-normal text-red-400 hover:text-red-600 hover:underline"
              title="Never email this company again (wrong vertical / junk record)"
            >
              block
            </button>
          </form>
        )}
      </h1>
      {p.blocked_at ? (
        <p className="mt-1 text-xs text-gray-500">
          Blocked {p.blocked_reason ? `— ${p.blocked_reason}` : ""} · no campaign will ever email
          this company while blocked.
        </p>
      ) : null}
      <p className="mt-1 text-sm text-gray-500">
        {p.office_city ?? ""}
        {p.email ? ` · ${p.email}` : ""}
        {p.phone ? ` · ${p.phone}` : ""}
        {p.commercial_signal ? " · commercial signal" : ""}
        {p.website ? (
          <>
            {" · "}
            <a href={p.website} target="_blank" rel="noreferrer" className="text-brand hover:underline">
              website ↗
            </a>
          </>
        ) : null}
        {p.contact_form_url ? (
          <>
            {" · "}
            <a href={p.contact_form_url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
              contact form ↗
            </a>
          </>
        ) : null}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Emails sent", value: sends.length },
          { label: "Opened", value: opens },
          { label: "Clicked", value: clicks },
          { label: "Offer views", value: p.claim_views, hot: p.claim_views > 0 },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <div className={`text-2xl font-semibold tabular-nums ${s.hot ? "text-amber-700" : ""}`}>
              {s.value}
            </div>
            <div className="text-xs uppercase tracking-wide text-gray-400">{s.label}</div>
          </div>
        ))}
      </div>
      {p.last_claim_view_at ? (
        <p className="mt-2 text-xs text-amber-700">
          Last read an offer page {fmt(p.last_claim_view_at)} — that&apos;s the hottest signal we track.
        </p>
      ) : null}

      {account ? (
        <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4">
          <h2 className="text-sm font-bold text-green-900">
            Converted — {account.company_name}
          </h2>
          <p className="mt-1 text-sm text-green-900">
            {account.email}
            {account.contact_name ? ` · ${account.contact_name}` : ""}
            {account.phone ? ` · ${account.phone}` : ""}
            {" · joined "}
            {fmt(account.created_at)} ·{" "}
            <Link href="/customers" className="underline">
              customer roster
            </Link>
          </p>
          {unlocks.length ? (
            <ul className="mt-2 space-y-1 text-sm text-green-900">
              {unlocks.map((u, i) => (
                <li key={i}>
                  {u.prop_id ? (
                    <Link href={`/properties/${u.prop_id}`} className="font-semibold underline">
                      {u.prop_address ?? displayName(u.prop_name ?? "lead")}
                    </Link>
                  ) : (
                    <span className="font-semibold">deleted lead</span>
                  )}
                  {u.prop_city ? `, ${u.prop_city}` : ""} —{" "}
                  {u.kind === "free"
                    ? "free claim"
                    : u.kind === "exclusive"
                      ? `EXCLUSIVE, ${usd(u.price_cents)}`
                      : `paid, ${usd(u.price_cents)}`}{" "}
                  · {u.trade} · {fmt(u.at)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-green-800">No unlocks yet.</p>
          )}
        </div>
      ) : null}

      {p.email ? (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-bold text-gray-900">
            Reply to {p.email} <span className="font-normal text-gray-400">— sends from leads@, logged below, opens tracked</span>
          </h2>
          {searchParams.reply === "sent" ? (
            <p className="mt-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Sent.</p>
          ) : searchParams.reply ? (
            <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              Not sent ({searchParams.reply === "noemail" ? "no email on file" : searchParams.reply === "missing" ? "subject and message are required" : "send failed — check RESEND config"}).
            </p>
          ) : null}
          <form action={replyToCompany} className="mt-3 space-y-2">
            <input type="hidden" name="id" value={p.id} />
            <input
              name="subject"
              defaultValue={(() => {
                const s = outreach[0]?.o.message?.match(/^SUBJECT(?:\[[AB]\])?: (.*)$/m)?.[1];
                return s ? (s.startsWith("Re:") ? s : `Re: ${s}`) : "";
              })()}
              placeholder="Subject"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              required
            />
            <textarea
              name="body"
              rows={7}
              placeholder="Write the reply — plain text; blank lines become paragraphs, links become clickable."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              required
            />
            <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
              Send from leads@
            </button>
          </form>
        </div>
      ) : null}

      {p.phone ? (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-bold text-gray-900">
            Text {p.phone}{" "}
            <span className="font-normal text-gray-400">
              — one-to-one reply/follow-up, logged below, STOP honored
            </span>
          </h2>
          {smsOptedOut ? (
            <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              This number replied STOP — sending is blocked until they text START.
            </p>
          ) : null}
          {searchParams.sms === "sent" ? (
            <p className="mt-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Sent.</p>
          ) : searchParams.sms ? (
            <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              Not sent (
              {searchParams.sms === "missing"
                ? "message is required"
                : searchParams.sms === "nophone"
                  ? "no phone on file"
                  : searchParams.sms}
              ).
            </p>
          ) : null}
          {smsThread.length ? (
            <ul className="mt-3 space-y-1.5">
              {smsThread.map((m) => (
                <li key={m.id} className={`flex ${m.direction === "in" ? "justify-start" : "justify-end"}`}>
                  <div
                    className={`max-w-md rounded-lg px-3 py-1.5 text-sm ${
                      m.direction === "in" ? "bg-gray-100 text-gray-800" : "bg-brand/10 text-gray-800"
                    }`}
                  >
                    {m.body}
                    <div className="mt-0.5 text-[10px] text-gray-400">
                      {m.direction === "in" ? "them" : "you"} · {fmt(m.created_at)}
                      {m.direction === "out" ? ` · ${m.status}` : ""}
                      {m.error_code ? ` (${m.error_code})` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {!smsOptedOut ? (
            <form action={smsCompany} className="mt-3 space-y-2">
              <input type="hidden" name="id" value={p.id} />
              <textarea
                name="body"
                rows={3}
                maxLength={1200}
                placeholder="Text message — plain text, keep it short (160 chars = 1 segment)."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                required
              />
              <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
                Send SMS
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      <h2 className="mt-8 text-lg font-semibold">Outreach history</h2>
      <p className="mt-1 text-sm text-gray-500">
        Every campaign email this company received, newest first.
      </p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2.5 font-medium">Lead pitched</th>
              <th className="px-3 py-2.5 font-medium">Trade</th>
              <th className="px-3 py-2.5 font-medium">Sent</th>
              <th className="px-3 py-2.5 font-medium">Opened</th>
              <th className="px-3 py-2.5 font-medium">Clicked</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {outreach.map(({ o, prop_address, prop_city, prop_name }) => {
              const t = rowTrade(o.claim_url);
              return (
                <tr key={o.id} className={o.status === "bounced" ? "bg-red-50/50" : "hover:bg-gray-50"}>
                  <td className="px-4 py-3">
                    {o.property_id && t ? (
                      <Link
                        href={`/campaigns/prospecting/${o.property_id}?trade=${t}`}
                        className="font-medium text-gray-900 hover:text-brand hover:underline"
                      >
                        {prop_address ?? displayName(prop_name ?? "lead")}
                      </Link>
                    ) : (
                      <span className="font-medium text-gray-900">
                        {prop_address ?? "Direct reply (no lead attached)"}
                      </span>
                    )}
                    <div className="text-xs text-gray-400">{prop_city ?? ""}</div>
                    {o.message ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-brand hover:underline">
                          view email
                        </summary>
                        <pre className="mt-2 max-w-xl whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
                          {o.message}
                        </pre>
                      </details>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    {t ? (
                      <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-bold text-brand">
                        {TRADES[t].label}
                      </span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">
                        Reply
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-gray-500">
                    {o.status === "skipped" ? (
                      <span className="text-gray-400">not sent (no email)</span>
                    ) : (
                      fmt(o.sent_at) ?? "queued"
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {o.opened_at ? (
                      <span className="text-green-700">
                        {fmt(o.opened_at)}
                        {o.open_count > 1 ? ` ×${o.open_count}` : ""}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {o.clicked_at ? (
                      <span className="font-medium text-green-700">
                        {fmt(o.clicked_at)}
                        {o.click_count > 1 ? ` ×${o.click_count}` : ""}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {o.status === "bounced" ? (
                      <span className="font-medium text-red-600">Bounced</span>
                    ) : (
                      <span className="capitalize text-gray-500">{o.status}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {outreach.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                  No campaign emails yet for this company.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
