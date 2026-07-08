// 6x9 postcard HTML for Lob. Front = branded teaser with the buyer's logo;
// back = their personalized note with a clear address area (Lob overlays the
// recipient block on the lower-right, so we keep the message to the top/left).
// Rendered at 9.25in x 6.25in (0.125in bleed) @ 300dpi.

import type { Dossier, DossierAerial } from "./dossier";
import { personalizeLetter } from "./personalize";

type BuyerLike = {
  company_name: string;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  logo_url?: string | null;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildPostcardHtml(
  d: Dossier,
  buyer: BuyerLike,
  accent: string
): { front: string; back: string } {
  const logo = buyer.logo_url
    ? `<img src="${esc(buyer.logo_url)}" style="max-height:0.9in;max-width:2.6in;object-fit:contain" />`
    : `<div style="font:700 26px sans-serif;color:#fff">${esc(buyer.company_name)}</div>`;

  // Property facts + timing fill the card's midsection. Deliberately NO dollar
  // figure on the owner-facing card: the sizing is often projected (raw-dirt
  // sites), a wrong number burns credibility, and printing a range anchors the
  // buyer's own future bid against them. The estimate stays in buyer-facing
  // surfaces (teaser, job sheet); here the hook is timing + preparedness.
  const heroTitle = d.est_completion ? `Opens ${fmtMonth(d.est_completion)}` : "Opening soon";
  const stats = [
    `est. ${Math.round(d.turf_sqft).toLocaleString()} sq ft of grounds`,
    d.acres >= 0.5 ? `${d.acres >= 10 ? Math.round(d.acres) : d.acres.toFixed(1)}-acre site` : null,
  ]
    .filter(Boolean)
    .join(" &nbsp;&middot;&nbsp; ");

  // Keep all content inside Lob's 0.125in bleed + a safe print margin: the panel
  // inset is 0.55in so nothing clips at the left/right edges when trimmed.
  // Absolutely-positioned sections (top / middle / bottom). Lob's renderer
  // ignores the \`inset\` shorthand, won't stretch height from top+bottom, and
  // doesn't distribute flex children — so we place each block by its own edge.
  const front = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{margin:0}html,body{margin:0;padding:0}
    .wrap{width:9.25in;height:6.25in;background:${accent};color:#fff;font-family:Helvetica,Arial,sans-serif;position:relative;overflow:hidden}
    .logo{position:absolute;top:0.55in;left:0.55in;background:rgba(255,255,255,0.14);border-radius:10px;padding:10px 14px}
    .city{position:absolute;top:0.62in;right:0.55in;text-align:right;font:600 13px sans-serif;opacity:0.9}
    .head{position:absolute;top:1.65in;left:0.55in;width:7.9in}
    .value{position:absolute;top:3.55in;left:0.55in;width:8.15in}
    .chip{display:inline-block;background:rgba(255,255,255,0.14);border-radius:12px;padding:14px 20px}
    .foot{position:absolute;bottom:0.55in;left:0.55in;width:8.15in;font:600 16px sans-serif}
  </style></head><body><div class="wrap">
    <div class="logo">${logo}</div>
    <div class="city">${esc((d.city ?? "") + (d.county ? ", " + d.county + " County" : ""))}</div>
    <div class="head">
      <div style="font:800 40px sans-serif;line-height:1.08">A grounds contract<br/>is coming.</div>
      <div style="margin-top:16px;font:500 19px sans-serif;max-width:6.4in;opacity:0.95">
        ${esc(d.name)} is being built. When it opens, someone wins the year-round grounds maintenance.
      </div>
    </div>
    <div class="value">
      <div class="chip">
        <div style="font:800 44px sans-serif;line-height:1">${esc(heroTitle)}</div>
        <div style="margin-top:8px;font:600 14px sans-serif;opacity:0.92">grounds vendors are typically chosen ~90 days before opening</div>
      </div>
      ${stats ? `<div style="margin-top:14px;font:600 15px sans-serif;opacity:0.92">${stats}</div>` : ""}
    </div>
    <div class="foot">We&rsquo;d like it to be us. &mdash; ${esc(buyer.company_name)}${buyer.phone ? " &middot; " + esc(buyer.phone) : ""}</div>
  </div></body></html>`;

  // Personalize the intro letter and trim it for the card back.
  const letter = personalizeLetter(d.intro_letter, buyer)
    .replace(/^Subject:.*\n+/i, "")
    .split("\n")
    .slice(0, 14)
    .join("\n");

  // Lob overlays the recipient address + postage on the RIGHT side of the
  // back, so the left column is ours full-height: a readable letter up top
  // and a brand anchor pinned bottom-left.
  const back = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{margin:0}html,body{margin:0;padding:0}
    .wrap{width:9.25in;height:6.25in;font-family:Helvetica,Arial,sans-serif;color:#1f2937;position:relative}
    .msg{position:absolute;top:0.45in;left:0.5in;width:4.9in;font-size:13px;line-height:1.55;white-space:pre-wrap}
    .bar{position:absolute;top:0;left:0;width:9.25in;height:0.18in;background:${accent}}
    .brand{position:absolute;bottom:0.5in;left:0.5in;width:4.9in;border-top:3px solid ${accent};padding-top:10px}
  </style></head><body><div class="wrap"><div class="bar"></div>
    <div class="msg">${esc(letter)}</div>
    <div class="brand">
      <div style="font:700 15px sans-serif;color:${accent}">${esc(buyer.company_name)}</div>
      <div style="margin-top:3px;font:500 12px sans-serif;color:#4b5563">Commercial grounds maintenance${buyer.phone ? ` &middot; ${esc(buyer.phone)}` : ""}${buyer.email ? ` &middot; ${esc(buyer.email)}` : ""}</div>
    </div>
  </div></body></html>`;

  return { front, back };
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/** "2028-09-01" -> "Sep 2028" (falls back to the raw string). */
function fmtMonth(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

type ProspectArt = {
  name: string | null;
  city: string | null;
  aerial: DossierAerial | null;
  turf_sqft: number | null;
  monthly: number | null;
  estimate_lo: number | null;
  estimate_hi: number | null;
};

/**
 * Self-serve prospect postcard: front = the property from above with the parcel
 * outline + measured-turf caption + estimate + a QR to the buyer's hosted quote;
 * back = a short buyer-branded note (Lob overlays the address block lower-right,
 * so the message stays top-left). All layout uses explicit positioning — Lob's
 * renderer ignores the `inset` shorthand and doesn't distribute flex children.
 */
export function buildProspectPostcardHtml(args: {
  prospect: ProspectArt;
  buyer: BuyerLike;
  proposalUrl: string;
  qrDataUrl: string;
  /** Remote URL for the aerial JPEG (Lob caps inline HTML at 10k chars, so the
   *  image is served by /api/postcard-asset and referenced by URL, not embedded). */
  aerialImageUrl: string | null;
  accent: string;
}): { front: string; back: string } {
  const { prospect: p, buyer, proposalUrl, qrDataUrl, aerialImageUrl, accent } = args;
  const a = p.aerial;
  const w = a?.width ?? 1000;
  const h = a?.height ?? 700;

  const logo = buyer.logo_url
    ? `<img src="${esc(buyer.logo_url)}" style="max-height:0.7in;max-width:2.6in;object-fit:contain" />`
    : `<div style="font:700 22px sans-serif;color:#fff">${esc(buyer.company_name)}</div>`;

  const estimate =
    p.estimate_lo != null && p.estimate_hi != null
      ? `${usd(p.estimate_lo)}&ndash;${usd(p.estimate_hi)}/yr`
      : p.monthly != null
        ? `${usd(p.monthly)}/mo`
        : "Free estimate ready";

  const tile = aerialImageUrl
    ? `<img src="${esc(aerialImageUrl)}" style="position:absolute;top:0;left:0;width:9.25in;height:6.25in" />` +
      (a?.outline?.length
        ? `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="position:absolute;top:0;left:0;width:9.25in;height:6.25in">` +
          a.outline
            .map(
              (pts) =>
                `<polygon points="${pts}" fill="none" stroke="#ffe14d" stroke-width="${Math.max(2, w / 350)}" stroke-dasharray="${w / 90} ${w / 140}"/>`
            )
            .join("") +
          `</svg>`
        : "")
    : `<div style="position:absolute;top:0;left:0;width:9.25in;height:6.25in;background:${accent}"></div>`;

  // Right-side panel (explicit box; children flow top-down — no flex needed).
  const front = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{margin:0}html,body{margin:0;padding:0}
    .wrap{width:9.25in;height:6.25in;position:relative;overflow:hidden;font-family:Helvetica,Arial,sans-serif}
    .panel{position:absolute;top:0;left:5.15in;width:4.1in;height:6.25in;background:${accent};color:#fff}
    .pin{position:absolute;top:0.5in;left:0.4in;width:3.3in}
    .qr{position:absolute;bottom:0.5in;left:0.4in;width:3.3in}
    .qr img{width:1.5in;height:1.5in;background:#fff;padding:0.08in;border-radius:8px;float:left;margin-right:0.2in}
  </style></head><body><div class="wrap">
    ${tile}
    <div class="panel">
      <div class="pin">
        <div style="margin-bottom:0.2in">${logo}</div>
        <div style="font:800 30px sans-serif;line-height:1.1">We already measured your grounds.</div>
        <div style="margin-top:0.14in;font:500 15px sans-serif;opacity:0.95">${esc(p.name ?? "Your property")}${p.turf_sqft ? ` &mdash; about ${Math.round(p.turf_sqft).toLocaleString()} sq ft of turf` : ""}.</div>
        <div style="margin-top:0.16in;font:800 26px sans-serif">${estimate}</div>
        <div style="font:500 12px sans-serif;opacity:0.9">estimated full-service maintenance</div>
      </div>
      <div class="qr">
        <img src="${esc(qrDataUrl)}" />
        <div style="font:700 15px sans-serif;overflow:hidden">Scan for your full quote</div>
        <div style="margin-top:0.06in;font:500 12px sans-serif;opacity:0.9;overflow:hidden">Measurement, scope &amp; price &mdash; ${esc(buyer.company_name)}${buyer.phone ? " &middot; " + esc(buyer.phone) : ""}</div>
      </div>
    </div>
  </div></body></html>`;

  const back = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{margin:0}html,body{margin:0;padding:0}
    .wrap{width:9.25in;height:6.25in;font-family:Helvetica,Arial,sans-serif;color:#1f2937;position:relative}
    .bar{position:absolute;top:0;left:0;width:9.25in;height:0.18in;background:${accent}}
    .msg{position:absolute;top:0.5in;left:0.5in;width:4.6in;font-size:12px;line-height:1.55}
    .msg h2{font-size:17px;margin:0 0 0.12in 0;color:#111827}
    .msg .sig{margin-top:0.2in;font-weight:600}
    .msg .url{margin-top:0.14in;font-size:11px;color:#6b7280;word-break:break-all}
  </style></head><body><div class="wrap"><div class="bar"></div>
    <div class="msg">
      <h2>${esc(buyer.company_name)}</h2>
      <div>We measured the grounds at ${esc(p.name ?? "your property")}${p.city ? `, ${esc(p.city)}` : ""} from current aerial imagery and prepared a complete maintenance estimate. Scan the code on the front to review it &mdash; then book a free walkthrough to lock the exact price.</div>
      <div class="sig">${esc(buyer.company_name)}${buyer.phone ? ` &middot; ${esc(buyer.phone)}` : ""}</div>
      <div class="url">${esc(proposalUrl)}</div>
    </div>
  </div></body></html>`;

  return { front, back };
}
