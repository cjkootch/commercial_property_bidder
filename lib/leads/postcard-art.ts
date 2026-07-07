// 6x9 postcard HTML for Lob. Front = branded teaser with the buyer's logo;
// back = their personalized note with a clear address area (Lob overlays the
// recipient block on the lower-right, so we keep the message to the top/left).
// Rendered at 9.25in x 6.25in (0.125in bleed) @ 300dpi.

import type { Dossier } from "./dossier";
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
    .head{position:absolute;top:2.0in;left:0.55in;width:7.9in}
    .foot{position:absolute;bottom:0.55in;left:0.55in;width:8.15in;font:600 16px sans-serif}
  </style></head><body><div class="wrap">
    <div class="logo">${logo}</div>
    <div class="city">${esc((d.city ?? "") + (d.county ? ", " + d.county + " County" : ""))}</div>
    <div class="head">
      <div style="font:800 40px sans-serif;line-height:1.08">A grounds contract<br/>is coming.</div>
      <div style="margin-top:16px;font:500 19px sans-serif;max-width:5.5in;opacity:0.95">
        ${esc(d.name)} is being built. When it opens, someone wins the year-round grounds maintenance &mdash; an estimated ${usd(d.annual_lo)}&ndash;${usd(d.annual_hi)}/yr contract.
      </div>
    </div>
    <div class="foot">We&rsquo;d like it to be us. &mdash; ${esc(buyer.company_name)}${buyer.phone ? " &middot; " + esc(buyer.phone) : ""}</div>
  </div></body></html>`;

  // Personalize the intro letter and trim it for the card back.
  const letter = personalizeLetter(d.intro_letter, buyer)
    .replace(/^Subject:.*\n+/i, "")
    .split("\n")
    .slice(0, 14)
    .join("\n");

  const back = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{margin:0}html,body{margin:0;padding:0}
    .wrap{width:9.25in;height:6.25in;font-family:Helvetica,Arial,sans-serif;color:#1f2937;position:relative}
    .msg{position:absolute;top:0.4in;left:0.4in;width:4.7in;font-size:11px;line-height:1.5;white-space:pre-wrap}
    .bar{position:absolute;top:0;left:0;width:9.25in;height:0.18in;background:${accent}}
  </style></head><body><div class="wrap"><div class="bar"></div>
    <div class="msg">${esc(letter)}</div>
  </div></body></html>`;

  return { front, back };
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}
