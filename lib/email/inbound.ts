// Minimal inbound-email parsing for the SES → SNS webhook. Replies are the
// conversion event of the whole outreach machine — this turns a raw MIME blob
// into {from, subject, text} well enough to alert the operator and match the
// sender to a company profile. Best-effort by design: a reply we can only
// partially parse still beats a reply nobody sees.

export type InboundEmail = {
  from: string | null;
  fromEmail: string | null;
  subject: string | null;
  /** Plain-text body (or a readable fallback), truncated. */
  text: string;
};

const MAX_BODY = 4000;

/** Unfold headers, find one by name (case-insensitive). */
function header(rawHeaders: string, name: string): string | null {
  const unfolded = rawHeaders.replace(/\r?\n[ \t]+/g, " ");
  const m = unfolded.match(new RegExp(`^${name}:[ \\t]*(.+)$`, "im"));
  return m ? m[1].trim() : null;
}

/** RFC 2047 encoded-words (=?utf-8?B?...?= / =?utf-8?Q?...?=) → text. */
function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, _cs, enc, data) => {
    try {
      if (enc.toLowerCase() === "b") return Buffer.from(data, "base64").toString("utf8");
      return decodeQp(data.replace(/_/g, " "));
    } catch {
      return data;
    }
  });
}

/** Quoted-printable → text. Soft breaks removed; consecutive =XX bytes are
 *  decoded as ONE buffer so multibyte UTF-8 sequences (=E2=80=99) survive. */
function decodeQp(s: string): string {
  return s.replace(/=\r?\n/g, "").replace(/(?:=[0-9A-F]{2})+/gi, (run) => {
    try {
      return Buffer.from(run.replace(/=/g, ""), "hex").toString("utf8");
    } catch {
      return run;
    }
  });
}

function decodeBody(body: string, encoding: string | null): string {
  const enc = (encoding ?? "").toLowerCase();
  if (enc.includes("base64")) {
    try {
      return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
    } catch {
      return body;
    }
  }
  if (enc.includes("quoted-printable")) return decodeQp(body);
  return body;
}

/** Pull the first text/plain part out of a (possibly nested) multipart body;
 *  falls back to a crudely de-tagged text/html part, then the raw body. */
function extractText(rawHeaders: string, body: string): string {
  const ct = header(rawHeaders, "Content-Type") ?? "";
  const boundary = ct.match(/boundary="?([^";]+)"?/i)?.[1];
  if (!boundary) {
    const decoded = decodeBody(body, header(rawHeaders, "Content-Transfer-Encoding"));
    return /text\/html/i.test(ct) ? decoded.replace(/<[^>]+>/g, " ") : decoded;
  }
  const parts = body.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?`));
  let html: string | null = null;
  for (const part of parts) {
    const sep = part.search(/\r?\n\r?\n/);
    if (sep === -1) continue;
    const ph = part.slice(0, sep);
    const pb = part.slice(sep).trim();
    const pct = header(ph, "Content-Type") ?? "";
    if (/multipart\//i.test(pct)) {
      const inner = extractText(ph, pb);
      if (inner.trim()) return inner;
    }
    if (/text\/plain/i.test(pct)) return decodeBody(pb, header(ph, "Content-Transfer-Encoding"));
    if (/text\/html/i.test(pct) && html === null)
      html = decodeBody(pb, header(ph, "Content-Transfer-Encoding")).replace(/<[^>]+>/g, " ");
  }
  return html ?? body;
}

/** Parse a raw RFC-822 message (SES SNS `content`) into the alert fields. */
export function parseInboundEmail(raw: string): InboundEmail {
  const sep = raw.search(/\r?\n\r?\n/);
  const rawHeaders = sep === -1 ? raw : raw.slice(0, sep);
  const body = sep === -1 ? "" : raw.slice(sep);
  const fromRaw = header(rawHeaders, "From");
  const from = fromRaw ? decodeWords(fromRaw) : null;
  const fromEmail = fromRaw?.match(/<([^>]+)>/)?.[1]?.toLowerCase() ??
    fromRaw?.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() ??
    null;
  const subjectRaw = header(rawHeaders, "Subject");
  const text = extractText(rawHeaders, body).replace(/\r\n/g, "\n").trim().slice(0, MAX_BODY);
  return {
    from,
    fromEmail,
    subject: subjectRaw ? decodeWords(subjectRaw) : null,
    text,
  };
}
