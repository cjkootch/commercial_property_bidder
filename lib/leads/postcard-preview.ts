// Wrap the front/back postcard HTML documents into a single preview page. Each
// side is a full 9.25x6.25in HTML doc, so we embed them via <iframe srcdoc> and
// scale to card size — the buyer sees exactly what will print, rendered by their
// own browser (no server-side browser needed).

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

export function renderPostcardPreviewPage(front: string, back: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Postcard preview</title>
    <style>
      body{margin:0;background:#f3f4f6;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;color:#111827}
      h1{font-size:17px;margin:0 0 4px}
      .note{color:#6b7280;font-size:13px;margin:0 0 20px;max-width:560px}
      .card{margin:0 0 26px}
      .label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:8px}
      .frame{width:555px;height:375px;box-shadow:0 3px 16px rgba(0,0,0,.16);border-radius:8px;overflow:hidden;background:#fff}
      .frame iframe{width:888px;height:600px;border:0;transform:scale(.625);transform-origin:top left}
    </style></head><body>
    <h1>Postcard preview</h1>
    <p class="note">This is how your 6&times;9&Prime; postcard will print. On the back, our mail partner adds the recipient&rsquo;s address block and postage in the clear area on the right.</p>
    <div class="card"><div class="label">Front</div><div class="frame"><iframe srcdoc="${escAttr(front)}"></iframe></div></div>
    <div class="card"><div class="label">Back</div><div class="frame"><iframe srcdoc="${escAttr(back)}"></iframe></div></div>
  </body></html>`;
}
