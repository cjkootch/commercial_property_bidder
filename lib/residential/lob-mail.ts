// Lob direct mail preparation helpers for residential landscaping campaigns.
//
// These functions handle address validation, cost estimation, and campaign
// draft generation. No external API calls (Lob or otherwise) are made here.

import type {
  residentialLead,
  residentialMailCampaign,
  residentialPackage,
} from "../db/schema";

export type MailFormat = "postcard_6x9" | "postcard_6x11" | "letter";

export interface RecipientInput {
  address: string;
  city: string;
  state: string;
  zip: string;
  recipient_name?: string | null;
}

export interface ValidationResult {
  valid: boolean;
  reasons: string[];
}

/**
 * Validates that a recipient has the minimum required address fields.
 * Does not check if the address actually exists (no API calls).
 */
export function validateRecipientAddressShape(
  recipient: RecipientInput
): ValidationResult {
  const reasons: string[] = [];
  if (!recipient.address?.trim()) reasons.push("Missing address");
  if (!recipient.city?.trim()) reasons.push("Missing city");
  if (!recipient.state?.trim()) reasons.push("Missing state");
  if (!recipient.zip?.trim()) reasons.push("Missing zip");

  return {
    valid: reasons.length === 0,
    reasons,
  };
}

/**
 * Returns a Lob-ready address object shape.
 * Default name is "Current Resident" if no recipient name exists.
 */
export function formatLobAddressPayload(recipient: RecipientInput) {
  return {
    name: recipient.recipient_name?.trim() || "Current Resident",
    address_line1: recipient.address.trim(),
    address_city: recipient.city.trim(),
    address_state: recipient.state.trim(),
    address_zip: recipient.zip.trim(),
    address_country: "US",
  };
}

/**
 * Estimates the internal print + postage cost from Lob based on recipient count.
 * Uses conservative defaults for a standard account.
 */
export function estimateLobMailCost(
  recipientCount: number,
  mailFormat: MailFormat
): number {
  const rates: Record<MailFormat, number> = {
    postcard_6x9: 115, // $1.15
    postcard_6x11: 135, // $1.35
    letter: 150, // $1.50
  };
  return recipientCount * rates[mailFormat];
}

/**
 * Calculates the price to charge the client based on internal costs.
 * 2.5x markup with a $250 minimum.
 */
export function calculateClientPrice(
  internalCostCents: number,
  recipientCount: number
): number {
  const markup = 2.5;
  const minPriceCents = 25000;
  const calculated = Math.round(internalCostCents * markup);
  return Math.max(calculated, minPriceCents);
}

const POSTCARD_FRONT_TEMPLATE = `
<html>
<head>
<style>
  body { font-family: sans-serif; margin: 0; padding: 0; }
  .container { width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; background-color: #f0fdf4; color: #166534; border: 4px solid #166534; box-sizing: border-box; }
  h1 { font-size: 32px; margin-bottom: 10px; }
  p { font-size: 18px; }
</style>
</head>
<body>
  <div class="container">
    <h1>{{offer_headline}}</h1>
    <p>Professional lawn care for your new home.</p>
  </div>
</body>
</html>
`;

const POSTCARD_BACK_TEMPLATE = `
<html>
<head>
<style>
  body { font-family: sans-serif; margin: 0; padding: 40px; color: #374151; }
  h2 { color: #166534; font-size: 24px; margin-top: 0; }
  .cta { font-weight: bold; color: #166534; font-size: 20px; margin-top: 20px; }
  .footer { margin-top: 40px; font-size: 14px; color: #6b7280; }
</style>
</head>
<body>
  <h2>Welcome to the neighborhood!</h2>
  <p>New homes in your area often need a little extra help getting their lawns established and maintained.</p>
  <p>We are a local landscaping company providing fast, reliable service with simple flat-rate plans.</p>
  <div class="cta">Get your free estimate: {{cta_url}}</div>
  <p class="cta">Call us: {{company_phone}}</p>
  <div class="footer">
    Sent by {{company_name}}
  </div>
</body>
</html>
`;

const LETTER_TEMPLATE = `
<html>
<head>
<style>
  body { font-family: serif; padding: 1in; line-height: 1.5; color: #111; }
  .header { margin-bottom: 0.5in; text-align: right; }
  .offer { font-weight: bold; font-size: 1.2em; margin: 0.25in 0; }
  .cta { margin-top: 0.5in; border-top: 1px solid #ccc; padding-top: 0.2in; font-weight: bold; }
</style>
</head>
<body>
  <div class="header">
    <strong>{{company_name}}</strong><br>
    {{company_phone}}
  </div>

  <p>Dear Neighbor,</p>

  <p>Congratulations on your new home! We are {{company_name}}, a local landscaping team serving your area.</p>

  <p class="offer">{{offer_headline}}</p>

  <p>Establishing a new yard or maintaining a recently sold property takes work. We offer recurring mowing, bed maintenance, and seasonal cleanups so you can enjoy your new home without the stress of yard work.</p>

  <p>Our flat-rate plans are simple, reliable, and require no long-term contracts.</p>

  <div class="cta">
    Visit {{cta_url}} for a fast estimate or call us at {{company_phone}}.
  </div>

  <p>Best regards,<br>The {{company_name}} Team</p>
</body>
</html>
`;

export interface CampaignDraftOptions {
  company_name: string;
  company_phone: string;
  cta_url: string;
  offer_headline?: string;
  mail_format?: MailFormat;
}

/**
 * Builds a deterministic campaign draft object.
 */
export function buildLobMailCampaignDraft(
  pkg: typeof residentialPackage.$inferSelect,
  validRecipients: RecipientInput[],
  opts: CampaignDraftOptions
) {
  const mail_format = opts.mail_format || "postcard_6x9";
  const offer_headline = opts.offer_headline || "Fast Local Lawn Care Estimates";
  const count = validRecipients.length;
  const internalCost = estimateLobMailCost(count, mail_format);
  const clientPrice = calculateClientPrice(internalCost, count);

  let proofFront = "";
  let proofBack = "";

  if (mail_format.startsWith("postcard")) {
    proofFront = POSTCARD_FRONT_TEMPLATE.replace(
      "{{offer_headline}}",
      offer_headline
    );
    proofBack = POSTCARD_BACK_TEMPLATE.replace(
      "{{offer_headline}}",
      offer_headline
    )
      .replace("{{company_name}}", opts.company_name)
      .replace("{{company_phone}}", opts.company_phone)
      .replace("{{cta_url}}", opts.cta_url);
  } else {
    proofFront = LETTER_TEMPLATE.replace("{{offer_headline}}", offer_headline)
      .replace(/{{company_name}}/g, opts.company_name)
      .replace(/{{company_phone}}/g, opts.company_phone)
      .replace("{{cta_url}}", opts.cta_url);
    proofBack = "Letter is single-sided proof";
  }

  return {
    name: `Mail Campaign: ${pkg.name} (${new Date().toLocaleDateString()})`,
    mail_format,
    offer_headline,
    proof_front_html: proofFront,
    proof_back_html: proofBack,
    mailpiece_count: count,
    estimated_print_postage_cost_cents: internalCost,
    client_price_cents: clientPrice,
    status: "proof_ready" as const,
  };
}
