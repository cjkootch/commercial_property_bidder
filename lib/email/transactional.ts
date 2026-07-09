// Shared transactional email shell: the branded card + button both magic-link
// flows (buyer + customer) send. Email-client-safe styling only — inline CSS,
// table-free single column, bulletproof button (padded <a>, no images).

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function magicLinkEmail(o: {
  brand: string;
  heading: string;
  intro: string;
  buttonLabel: string;
  link: string;
  footnote?: string;
}): string {
  return (
    `<div style="background:#f4f7f5;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">` +
    `<div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:14px;border:1px solid #e5e7eb;padding:32px 28px;">` +
    `<p style="margin:0 0 20px;font-size:19px;font-weight:700;color:#14532d;">🌿 ${esc(o.brand)}</p>` +
    `<h1 style="margin:0 0 10px;font-size:21px;line-height:1.3;color:#111827;">${esc(o.heading)}</h1>` +
    `<p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#4b5563;">${esc(o.intro)}</p>` +
    `<a href="${o.link}" style="display:inline-block;background:#2f7d4f;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:10px;">${esc(o.buttonLabel)}</a>` +
    `<p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#9ca3af;">Button not working? Paste this link into your browser:<br>` +
    `<a href="${o.link}" style="color:#2f7d4f;word-break:break-all;">${o.link}</a></p>` +
    (o.footnote
      ? `<hr style="border:none;border-top:1px solid #f3f4f6;margin:24px 0;"><p style="margin:0;font-size:12px;color:#9ca3af;">${esc(o.footnote)}</p>`
      : "") +
    `</div></div>`
  );
}
