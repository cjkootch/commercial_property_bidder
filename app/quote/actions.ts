"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { contact, property } from "@/lib/db/schema";
import { getDefaultCompany } from "@/lib/db/queries";

const ICP_VALUES = [
  "self_storage",
  "office_park",
  "medical",
  "church",
  "daycare",
  "retail_strip",
  "industrial",
  "residential",
  "other",
] as const;

function s(formData: FormData, key: string): string {
  return ((formData.get(key) as string) || "").trim();
}

/**
 * Public quote-intake. Creates an inbound `property` lead (+ a contact) that
 * drops straight into the operator pipeline as `sourced`. No auth. A hidden
 * honeypot field deters bots; submissions are operator-reviewed before any
 * outreach, so this never triggers sends.
 */
export async function submitQuoteRequest(formData: FormData): Promise<void> {
  const type = s(formData, "type") === "commercial" ? "commercial" : "residential";

  // Honeypot: real users never fill this hidden field. Pretend success.
  if (s(formData, "website_hp")) redirect(`/quote?type=${type}&sent=1`);

  const contactName = s(formData, "contact_name");
  const email = s(formData, "email");
  const phone = s(formData, "phone");
  const address = s(formData, "address");
  const city = s(formData, "city");
  const zip = s(formData, "zip");
  const orgName = s(formData, "org_name"); // commercial: business / property name
  const notes = s(formData, "notes");

  // Minimal validity: a way to reach them + a location.
  if ((!email && !phone) || !address) {
    redirect(`/quote?type=${type}&error=1`);
  }

  const co = await getDefaultCompany();
  if (!co) redirect(`/quote?type=${type}&error=1`);

  const icpRaw = s(formData, "icp_type");
  const icp =
    type === "residential"
      ? "residential"
      : (ICP_VALUES as readonly string[]).includes(icpRaw)
        ? (icpRaw as (typeof ICP_VALUES)[number])
        : "other";

  const propName =
    type === "commercial"
      ? orgName || address || "Inbound commercial lead"
      : `${contactName || "Homeowner"} — ${[city, zip].filter(Boolean).join(" ") || address}`;

  const [prop] = await db
    .insert(property)
    .values({
      company_id: co.id,
      name: propName,
      address: address || null,
      city: city || null,
      zip: zip || null,
      icp_type: icp,
      owner_org: type === "commercial" ? orgName || null : null,
      source: "inbound",
      status: "sourced",
      notes: [`Inbound ${type} quote request.`, notes].filter(Boolean).join(" "),
    })
    .returning();

  if (contactName || email || phone) {
    await db.insert(contact).values({
      property_id: prop.id,
      full_name: contactName || "Inbound lead",
      email: email || null,
      phone: phone || null,
      source: "manual",
    });
  }

  redirect(`/quote?type=${type}&sent=1`);
}
