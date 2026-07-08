import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { residentialMailCampaign, residentialMailRecipient, residentialPackage } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { usd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MailCampaignDetail({ params }: { params: { id: string } }) {
  const campaign = await db.query.residentialMailCampaign.findFirst({
    where: eq(residentialMailCampaign.id, params.id),
  });

  if (!campaign) notFound();

  const pkg = await db.query.residentialPackage.findFirst({
    where: eq(residentialPackage.id, campaign.residential_package_id),
  });

  const recipients = await db.query.residentialMailRecipient.findMany({
    where: eq(residentialMailRecipient.residential_mail_campaign_id, campaign.id),
    orderBy: [asc(residentialMailRecipient.address)],
  });

  return (
    <div className="space-y-8">
      <div>
        <Link href="/dashboard/residential/mail" className="text-sm text-gray-500 hover:text-brand">
          ← All Campaigns
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{campaign.name}</h1>
          <StatusBadge status={campaign.status} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card title="Campaign Info">
          <Detail label="Package" value={pkg?.name || "Unknown"} />
          <Detail label="Provider" value={campaign.provider} />
          <Detail label="Format" value={campaign.mail_format.replace("_", " ")} />
          <Detail label="Created" value={new Date(campaign.created_at).toLocaleString()} />
        </Card>

        <Card title="Fulfillment Sizing">
          <Detail label="Recipients" value={String(campaign.mailpiece_count)} />
          <Detail
            label="Est. Internal Cost"
            value={usd(campaign.estimated_print_postage_cost_cents ? campaign.estimated_print_postage_cost_cents / 100 : 0)}
          />
          <Detail
            label="Client Price"
            value={usd(campaign.client_price_cents ? campaign.client_price_cents / 100 : 0)}
          />
        </Card>

        <Card title="Actions (Foundation Stub)">
          <div className="space-y-2 mt-2">
            <button disabled className="w-full rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-400 cursor-not-allowed">
              Approve Proof
            </button>
            <button disabled className="w-full rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-400 cursor-not-allowed">
              Submit Lob Test
            </button>
            <button disabled className="w-full rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-400 cursor-not-allowed">
              Submit Live Mail
            </button>
            <p className="text-[10px] text-gray-400 text-center uppercase tracking-wider font-medium">
              Actions disabled until Lob wiring
            </p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-4">
          <h2 className="text-lg font-medium">Front Proof Preview</h2>
          <div className="border border-gray-200 rounded-lg bg-white p-1 shadow-sm overflow-hidden">
             <div className="aspect-[3/2] w-full bg-gray-50 flex items-center justify-center overflow-auto p-4 border border-dashed border-gray-300 rounded">
                {campaign.proof_front_html ? (
                   <div dangerouslySetInnerHTML={{ __html: campaign.proof_front_html }} className="w-full h-full scale-[0.6] origin-top" />
                ) : (
                  <span className="text-gray-400">No front proof available</span>
                )}
             </div>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-medium">Back Proof Preview</h2>
           <div className="border border-gray-200 rounded-lg bg-white p-1 shadow-sm overflow-hidden">
             <div className="aspect-[3/2] w-full bg-gray-50 flex items-center justify-center overflow-auto p-4 border border-dashed border-gray-300 rounded">
                {campaign.proof_back_html ? (
                   <div dangerouslySetInnerHTML={{ __html: campaign.proof_back_html }} className="w-full h-full scale-[0.6] origin-top" />
                ) : (
                  <span className="text-gray-400">No back proof available</span>
                )}
             </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-medium">Recipients ({recipients.length})</h2>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-50 text-left uppercase tracking-wide text-gray-500 font-medium">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Address</th>
                <th className="px-4 py-2">City</th>
                <th className="px-4 py-2">State</th>
                <th className="px-4 py-2">ZIP</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Lob ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-600">
              {recipients.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">{r.recipient_name || "—"}</td>
                  <td className="px-4 py-2">{r.address}</td>
                  <td className="px-4 py-2">{r.city}</td>
                  <td className="px-4 py-2">{r.state}</td>
                  <td className="px-4 py-2">{r.zip}</td>
                  <td className="px-4 py-2 capitalize">{r.status}</td>
                  <td className="px-4 py-2 text-[10px] font-mono">{r.lob_postcard_id || r.lob_letter_id || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-4">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700",
    proof_ready: "bg-blue-100 text-blue-700",
    approved: "bg-green-100 text-green-700",
    submitted: "bg-indigo-100 text-indigo-700",
    mailed: "bg-purple-100 text-purple-700",
    completed: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-100 text-red-700",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-semibold ${
        colors[status] || "bg-gray-100 text-gray-700"
      }`}
    >
      {status.replace("_", " ")}
    </span>
  );
}
