// Branded email shells. Ported from lib/email/transactional.ts.
//
// Email-client-safe styling ONLY: inline CSS, single column, no external CSS, no
// images required, "bulletproof button" (a padded <a>, not a styled <button>),
// plus a visible plain-link fallback for clients that strip buttons. Every
// caller-supplied string is HTML-escaped — these bodies interpolate company
// names and notes that came from a CSV.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type BrandLook = {
  name: string;
  /** Hex, e.g. "#1f3a5f". Defaults to a neutral slate. */
  color?: string | null;
};

/** Magic-link / single-action email. Used by sign-in and any "open this record"
 *  link sent to a colleague. */
export function actionEmail(o: {
  brand: BrandLook;
  heading: string;
  intro: string;
  buttonLabel: string;
  link: string;
  footnote?: string;
}): string {
  const color = o.brand.color || "#1f3a5f";
  return (
    `<div style="background:#f4f5f7;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">` +
    `<div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:14px;border:1px solid #e5e7eb;padding:32px 28px;">` +
    `<p style="margin:0 0 20px;font-size:17px;font-weight:700;color:${color};">${esc(o.brand.name)}</p>` +
    `<h1 style="margin:0 0 10px;font-size:21px;line-height:1.3;color:#111827;">${esc(o.heading)}</h1>` +
    `<p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#4b5563;">${esc(o.intro)}</p>` +
    `<a href="${o.link}" style="display:inline-block;background:${color};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:10px;">${esc(
      o.buttonLabel
    )}</a>` +
    `<p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#9ca3af;">Button not working? Paste this link into your browser:<br>` +
    `<a href="${o.link}" style="color:${color};word-break:break-all;">${o.link}</a></p>` +
    (o.footnote
      ? `<hr style="border:none;border-top:1px solid #f3f4f6;margin:24px 0;"><p style="margin:0;font-size:12px;color:#9ca3af;">${esc(
          o.footnote
        )}</p>`
      : "") +
    `</div></div>`
  );
}

/** Plain prose email under a brand header — the shape an origination outreach
 *  letter actually wants (no button, no marketing furniture). `bodyText` is
 *  escaped and paragraph-split on blank lines. */
export function proseEmail(o: {
  brand: BrandLook;
  bodyText: string;
  /** CAN-SPAM footer for any non-transactional send: postal address + opt-out. */
  postalAddress?: string | null;
  unsubscribeUrl?: string | null;
}): string {
  const color = o.brand.color || "#1f3a5f";
  const paras = o.bodyText
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1f2937;">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const footer =
    o.postalAddress || o.unsubscribeUrl
      ? `<hr style="border:none;border-top:1px solid #f3f4f6;margin:22px 0 14px;">` +
        `<p style="margin:0;font-size:11px;line-height:1.6;color:#9ca3af;">` +
        (o.postalAddress ? `${esc(o.postalAddress)}<br>` : "") +
        (o.unsubscribeUrl
          ? `<a href="${o.unsubscribeUrl}" style="color:#9ca3af;">Unsubscribe</a>`
          : "") +
        `</p>`
      : "";
  return (
    `<div style="background:#ffffff;padding:24px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">` +
    `<div style="max-width:520px;margin:0 auto;">` +
    `<p style="margin:0 0 18px;font-size:15px;font-weight:700;color:${color};">${esc(o.brand.name)}</p>` +
    paras +
    footer +
    `</div></div>`
  );
}

/** Internal digest (the revisit queue email). Monospace-ish list, no branding —
 *  it goes to staff, not prospects. */
export function digestEmail(o: { heading: string; bodyText: string }): string {
  return (
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;">` +
    `<h1 style="margin:0 0 12px;font-size:18px;">${esc(o.heading)}</h1>` +
    `<pre style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.65;white-space:pre-wrap;color:#374151;">${esc(
      o.bodyText
    )}</pre>` +
    `</div>`
  );
}
