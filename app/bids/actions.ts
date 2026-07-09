"use server";

// Owner-side bid request: the reverse flow of the marketplace. An owner asks
// for competing bids; the buyer roster is the supply. v1 captures the request
// and notifies the operator (routing to matching buyers is manual for now).

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { bidRequest } from "@/lib/db/schema";
import { getDefaultCompany } from "@/lib/db/queries";
import { sendEmail } from "@/lib/integrations/resend";
import { asTrade, TRADES } from "@/lib/leads/trades";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export async function submitBidRequest(formData: FormData): Promise<void> {
  const name = ((formData.get("name") as string) || "").trim().slice(0, 120);
  const email = ((formData.get("email") as string) || "").trim().toLowerCase().slice(0, 200);
  const phone = ((formData.get("phone") as string) || "").trim().slice(0, 40) || null;
  const address = ((formData.get("address") as string) || "").trim().slice(0, 200);
  const city = ((formData.get("city") as string) || "").trim().slice(0, 80) || null;
  const trade = asTrade(formData.get("trade"));
  const notes = ((formData.get("notes") as string) || "").trim().slice(0, 2000) || null;

  if (!name || !email.includes("@") || !address) redirect("/bids?error=1");

  const rl = await rateLimit(`bidreq:ip:${clientIp()}`, 5, 3600);
  if (!rl.ok) redirect("/bids?error=rate");

  await db.insert(bidRequest).values({ name, email, phone, address, city, trade, notes });

  // The operator IS the routing engine in v1 — make sure they hear about it.
  const co = await getDefaultCompany();
  if (co?.email) {
    await sendEmail({
      to: co.email,
      subject: `Bid request: ${TRADES[trade].label} — ${address}${city ? `, ${city}` : ""}`,
      html:
        `<p><strong>New owner-side bid request</strong></p>` +
        `<p>${name} &lt;${email}&gt;${phone ? ` · ${phone}` : ""}</p>` +
        `<p>${address}${city ? `, ${city}` : ""} — wants ${TRADES[trade].noun}</p>` +
        (notes ? `<p>${notes.replace(/</g, "&lt;")}</p>` : "") +
        `<p><a href="https://greenkeep.us/requests">Open the requests queue</a></p>`,
      tags: { kind: "bid_request" },
    }).catch(() => null);
  }
  redirect("/bids?sent=1");
}

/** Operator: advance a request through new -> routed -> closed. */
export async function setBidRequestStatus(id: string, status: string): Promise<void> {
  const allowed = new Set(["new", "routed", "closed"]);
  if (!allowed.has(status)) return;
  const { eq } = await import("drizzle-orm");
  await db
    .update(bidRequest)
    .set({ status, updated_at: new Date() })
    .where(eq(bidRequest.id, id));
  redirect("/requests");
}
